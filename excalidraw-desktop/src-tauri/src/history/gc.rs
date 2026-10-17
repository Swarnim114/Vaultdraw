//! Deletes: thinning, size cap, own-blob sweep, takeover of dead devices' files, orphan sweep
//! (automatic versions only, M7), N1 trash expiry and the explicit deletes. Everything here runs
//! on the history worker thread (never on a command thread), so it can't race the writer.
//!
//! Planning is pure (`retention.rs`) and runs under the index read lock only; every unlink happens
//! with no index lock held, and the index is updated right after each unlink. Order everywhere:
//! deltas and path records, then keyframes, then blobs, so a crash at any point leaves every
//! remaining delta with its keyframe. ENOENT is fine (another device deleted it). Unknown or
//! invalid files are never deleted (D6).
//!
//! Choices beyond PLAN-H3 4: `after_write` runs the cap plan with versions only (own blobs wait
//! for the sweep) and never raises `over_cap` (only the sweep does); "delete all history" leaves
//! the drawing's own blobs to the next sweep (they still obey the 1 h unreferenced rule).
use super::{
    index::{self, Index},
    lineage,
    names::{self, BlobName, NameKind, VersionName},
    retention::{self, CapDelete, Env, Kind, Policy, HOUR_MS, UNSEEN_MS, DEAD_MS, V},
    HistorySettings, VaultHistory,
};
use crate::{err, ioerr, Result};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs,
    sync::{RwLockReadGuard, RwLockWriteGuard},
    time::{Duration, Instant},
};

/// What the last sweep found (shown in `history_status`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Report {
    /// "none" | "checkpoints" | "other-devices"
    pub over_cap: &'static str,
    /// A header the own-blob sweep needs could not be read (e.g. dataless): blobs were kept.
    pub gc_blocked: bool,
    /// `<sha>.<ext>` of own blob copies seen unreferenced → local time of the first sweep that saw
    /// it (the 1 h rule). Lives for the session.
    unref_since: HashMap<String, u64>,
}

impl Default for Report {
    fn default() -> Self {
        Report { over_cap: "none", gc_blocked: false, unref_since: HashMap::new() }
    }
}

/// What every GC entry point needs (built by the worker for each call).
pub(super) struct Ctx<'a> {
    pub vh: &'a VaultHistory,
    /// This device's id.
    pub dev: &'a str,
    pub now_ms: u64,
    pub settings: &'a HistorySettings,
}

type Off<'a> = &'a dyn Fn(u64) -> i32;

/// Own blobs must stay unreferenced this long before they go.
const OWN_BLOB_GRACE_MS: u64 = HOUR_MS;
/// `after_write` never unlinks more than this many files for the cap (the sweep finishes the job).
const AFTER_WRITE_CAP_UNLINKS: usize = 128;

fn rd(vh: &VaultHistory) -> RwLockReadGuard<'_, Index> {
    vh.read_index()
}
fn wr(vh: &VaultHistory) -> RwLockWriteGuard<'_, Index> {
    vh.index.write().unwrap_or_else(|p| p.into_inner())
}

fn cap_bytes(s: &HistorySettings) -> u64 {
    u64::from(s.size_cap_mb) * 1024 * 1024
}

// ---------------------------------------------------------------------------------------------
// Views and environment
// ---------------------------------------------------------------------------------------------

fn view_of(l: &index::Lineage) -> Vec<V<'_>> {
    l.versions
        .values()
        .map(|e| V {
            id: &e.name.id,
            dev: &e.name.dev,
            t: e.name.time_ms(),
            kind: match &e.name.kind {
                NameKind::Keyframe(_) => Kind::Keyframe,
                NameKind::Delta(_, k) => Kind::Delta(k),
                NameKind::Path => Kind::Path,
            },
            reason: e.reason(),
            size: e.size,
            path: e.head.as_ref().map(|h| h.path.as_str()),
        })
        .collect()
}

/// Newest ULID time per device over the whole index (for the takeover "moved past" rule),
/// computed lazily because only rare takeover candidates need it.
#[derive(Default)]
struct DevTimes(RefCell<Option<HashMap<String, u64>>>);

impl DevTimes {
    fn newest_of(&self, g: &Index, dev: &str) -> u64 {
        let mut m = self.0.borrow_mut();
        let m = m.get_or_insert_with(|| {
            let mut out: HashMap<String, u64> = HashMap::new();
            for e in g.lineages.values().flat_map(|l| l.versions.values()) {
                let t = out.entry(e.name.dev.clone()).or_insert(0);
                *t = (*t).max(e.name.time_ms());
            }
            out
        });
        m.get(dev).copied().unwrap_or(0)
    }
}

fn with_env<R>(ctx: &Ctx, g: &Index, dt: &DevTimes, off: Off, f: impl FnOnce(&Env) -> R) -> R {
    let last_seen = |d: &str| g.devices.get(d).copied();
    let newest_of = |d: &str| dt.newest_of(g, d);
    f(&Env { now: ctx.now_ms, me: ctx.dev, offset_secs: off, last_seen: &last_seen, newest_of: &newest_of })
}

/// Ids (and keyframe flag) a retention plan deletes from `lin`, leaves first.
fn plan_lineage(ctx: &Ctx, g: &Index, dt: &DevTimes, off: Off, lin: &str, orphan: bool) -> Vec<(String, bool)> {
    let Some(l) = g.lineages.get(lin) else { return Vec::new() };
    let view = view_of(l);
    let pol = Policy::from_settings(ctx.settings);
    let plan = with_env(ctx, g, dt, off, |env| if orphan { retention::plan_orphan(&view, env) } else { retention::plan(&view, &pol, env) });
    plan.into_iter().map(|d| (view[d.idx].id.to_string(), d.keyframe)).collect()
}

/// A header of this device is missing from the index (unreadable or dataless).
fn own_heads_missing(g: &Index, me: &str) -> bool {
    g.lineages.values().flat_map(|l| l.versions.values()).any(|e| e.name.dev == me && e.head.is_none())
}

/// Blobs referenced by any known header.
fn all_refs(g: &Index) -> HashSet<String> {
    g.lineages.values().flat_map(|l| l.versions.values()).filter_map(|e| e.head.as_ref()).flat_map(|h| h.blobs.iter().cloned()).collect()
}

/// Blobs referenced by this device's headers.
fn own_refs(g: &Index, me: &str) -> HashSet<String> {
    g.lineages.values().flat_map(|l| l.versions.values()).filter(|e| e.name.dev == me).filter_map(|e| e.head.as_ref()).flat_map(|h| h.blobs.iter().cloned()).collect()
}

// ---------------------------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------------------------

/// Performs unlinks and keeps the index in step. `limit` caps the number of unlinks (crash tests
/// and `after_write`); `touched` collects what the panel must refresh.
struct Exec<'a, 'b> {
    ctx: &'a Ctx<'b>,
    limit: usize,
    done: usize,
    stopped: bool,
    touched: BTreeSet<(String, String)>,
    shards: BTreeSet<String>,
    lineages: BTreeSet<String>,
}

impl<'a, 'b> Exec<'a, 'b> {
    fn new(ctx: &'a Ctx<'b>, limit: usize) -> Self {
        Exec { ctx, limit, done: 0, stopped: false, touched: BTreeSet::new(), shards: BTreeSet::new(), lineages: BTreeSet::new() }
    }

    fn budget_left(&mut self) -> bool {
        if self.done >= self.limit {
            self.stopped = true;
            return false;
        }
        true
    }

    /// Unlinks `name` of `lin` and removes it from the index. `true` when it is gone afterwards.
    fn unlink(&mut self, lin: &str, name: &VersionName, path: &str) -> bool {
        if !self.budget_left() {
            return false;
        }
        if self.ctx.vh.store.remove_version(lin, name).is_err() {
            return false;
        }
        wr(self.ctx.vh).remove(&name.id);
        self.done += 1;
        self.touched.insert((path.to_string(), lin.to_string()));
        self.lineages.insert(lin.to_string());
        true
    }

    /// Removes the indexed version `id`. A keyframe is only removed while no remaining entry
    /// references it. An id that is no longer indexed counts as gone.
    fn remove_version(&mut self, lin: &str, id: &str) -> bool {
        let found = {
            let g = rd(self.ctx.vh);
            let Some(l) = g.lineages.get(lin) else { return true };
            let Some(e) = l.versions.get(id) else { return true };
            if e.name.is_keyframe() && l.versions.values().any(|o| o.keyframe_id() == Some(id)) {
                return false;
            }
            (e.name.clone(), l.path.clone().unwrap_or_default())
        };
        self.unlink(lin, &found.0, &found.1)
    }

    fn execute(&mut self, lin: &str, plan: &[(String, bool)]) -> usize {
        let before = self.done;
        for (id, _) in plan {
            self.remove_version(lin, id);
            if self.stopped {
                break;
            }
        }
        self.done - before
    }

    /// Thinning of one lineage.
    fn retain(&mut self, dt: &DevTimes, off: Off, lin: &str, orphan: bool) -> usize {
        let plan = {
            let g = rd(self.ctx.vh);
            plan_lineage(self.ctx, &g, dt, off, lin, orphan)
        };
        self.execute(lin, &plan)
    }

    /// Every valid version file of `lin` on disk (and every indexed one), deltas and path records
    /// first, keyframes last. Unknown files stay. Returns the first error, after trying them all.
    fn purge_lineage(&mut self, lin: &str) -> Result<()> {
        let dir = self.ctx.vh.store.lineage_dir(lin, false)?;
        let mut names: BTreeMap<String, VersionName> = BTreeMap::new();
        if let Some(d) = dir {
            if let Ok(rdir) = fs::read_dir(d) {
                for e in rdir.flatten() {
                    if let Some(n) = e.file_name().to_str().and_then(VersionName::parse) {
                        names.insert(n.id.clone(), n);
                    }
                }
            }
        }
        let path = {
            let g = rd(self.ctx.vh);
            let Some(l) = g.lineages.get(lin) else { return self.finish_purge(lin, &names) };
            for e in l.versions.values() {
                names.entry(e.name.id.clone()).or_insert_with(|| e.name.clone());
            }
            l.path.clone().unwrap_or_default()
        };
        self.touched.insert((path.clone(), lin.to_string()));
        let mut first: Option<std::io::Error> = None;
        for keyframes in [false, true] {
            for n in names.values().filter(|n| n.is_keyframe() == keyframes) {
                match self.ctx.vh.store.remove_version(lin, n) {
                    Ok(_) => {
                        wr(self.ctx.vh).remove(&n.id);
                        self.done += 1;
                    }
                    Err(e) => {
                        first.get_or_insert(e);
                    }
                }
            }
        }
        self.lineages.insert(lin.to_string());
        match first {
            Some(e) => Err(ioerr(e)),
            None => Ok(()),
        }
    }

    fn finish_purge(&mut self, lin: &str, names: &BTreeMap<String, VersionName>) -> Result<()> {
        // Not indexed any more: only stray files on disk remain to be removed.
        let mut first = None;
        for keyframes in [false, true] {
            for n in names.values().filter(|n| n.is_keyframe() == keyframes) {
                if let Err(e) = self.ctx.vh.store.remove_version(lin, n) {
                    first.get_or_insert(e);
                }
            }
        }
        self.lineages.insert(lin.to_string());
        first.map_or(Ok(()), |e| Err(ioerr(e)))
    }

    /// Removes own copies of `key` (`<sha>.<ext>`), or only the given foreign ones.
    fn remove_blob_copies(&mut self, key: &str, pick: impl Fn(&index::BlobCopy) -> bool) -> usize {
        let Some((sha, ext)) = key.split_once('.') else { return 0 };
        let copies: Vec<index::BlobCopy> = rd(self.ctx.vh).blobs.get(key).map(|v| v.iter().filter(|c| pick(c)).cloned().collect()).unwrap_or_default();
        let mut removed = 0;
        for c in copies {
            if !self.budget_left() {
                break;
            }
            let name = BlobName { sha: sha.to_string(), dev: c.dev.clone(), epoch: c.epoch.clone(), ext: ext.to_string() };
            if self.ctx.vh.store.remove_blob(&name).is_err() {
                continue;
            }
            let mut g = wr(self.ctx.vh);
            if let Some(v) = g.blobs.get_mut(key) {
                v.retain(|x| !(x.dev == c.dev && x.epoch == c.epoch));
                if v.is_empty() {
                    g.blobs.remove(key);
                }
            }
            drop(g);
            self.shards.insert(sha[..2].to_string());
            self.done += 1;
            removed += 1;
        }
        removed
    }

    /// Cap plan over every lineage. Returns the unlinks it did.
    fn cap_versions(&mut self, excess: u64) -> usize {
        let plan = cap_plan_ids(self.ctx, excess);
        let before = self.done;
        for (lin, id) in plan {
            self.remove_version(&lin, &id);
            if self.stopped {
                break;
            }
        }
        self.done - before
    }

    /// Removes cleared-out folders and tells the panel what changed.
    fn finish(self) {
        let vh = self.ctx.vh;
        for lin in &self.lineages {
            if !rd(vh).lineages.contains_key(lin) {
                vh.store.remove_lineage_dir_if_empty(lin);
            }
        }
        for s in &self.shards {
            vh.store.remove_blob_shard_if_empty(s);
        }
        if !self.touched.is_empty() || !self.shards.is_empty() {
            let mut n = super::lock(&vh.notifier);
            for (p, l) in &self.touched {
                n.changed(p, l);
            }
            if self.touched.is_empty() {
                n.changed("", "");
            }
            n.status_changed();
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

/// Retention for one lineage right after a version was written to it (plus the cap when the
/// vault is over it). Must stay cheap: plan ≤ 50 µs, a handful of unlinks.
pub(super) fn after_write(ctx: &Ctx, lineage: &str) {
    after_write_with(ctx, lineage, &retention::local_offset_secs);
}

pub(super) fn after_write_with(ctx: &Ctx, lineage: &str, off: Off) {
    let dt = DevTimes::default();
    let mut ex = Exec::new(ctx, usize::MAX);
    ex.retain(&dt, off, lineage, false);
    let cap = cap_bytes(ctx.settings);
    if cap > 0 && super::lock(&ctx.vh.gc).over_cap == "none" {
        let total = rd(ctx.vh).total_bytes();
        if total > cap {
            let mut capped = Exec::new(ctx, AFTER_WRITE_CAP_UNLINKS);
            capped.cap_versions(total - cap);
            ex.touched.append(&mut capped.touched);
            ex.lineages.append(&mut capped.lineages);
        }
    }
    ex.finish();
}

/// `retain` for tests: one lineage, injected time zone, at most `limit` unlinks. Returns how many
/// files it removed.
pub(super) fn retain_with(ctx: &Ctx, lineage: &str, off: Off, limit: usize) -> usize {
    let dt = DevTimes::default();
    let mut ex = Exec::new(ctx, limit);
    let n = ex.retain(&dt, off, lineage, false);
    ex.finish();
    n
}

/// Orphan sweep of one lineage: automatic versions and what only they need go, checkpoints and
/// unknown codes stay (M7). Returns how many files it removed.
pub(super) fn delete_automatic(ctx: &Ctx, lineage: &str) -> usize {
    let dt = DevTimes::default();
    let mut ex = Exec::new(ctx, usize::MAX);
    let n = ex.retain(&dt, &retention::local_offset_secs, lineage, true);
    ex.finish();
    n
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    Start,
    Heads,
    Retention,
    Inputs,
    Trash,
    Orphans,
    CapPlan,
    CapExec,
    CapBlobs,
    OwnBlobs,
    ForeignScan,
    ForeignHeads,
    Foreign,
    Done,
}

/// The whole-vault sweep (daily and on vault open), resumable in chunks of `budget`.
pub(super) struct Sweep {
    phase: Phase,
    queue: Vec<String>,
    cap_queue: Vec<(String, String)>,
    trash: Vec<String>,
    orphans: Vec<String>,
    removed: Vec<String>,
    blocked: bool,
    foreign_ok: bool,
    dt: DevTimes,
    unref: HashMap<String, u64>,
    own_refs: HashSet<String>,
    all_refs: HashSet<String>,
    /// `Index::refs_gen` when `own_refs` / `all_refs` were taken (writes land between steps).
    refs_gen: u64,
    newest_epoch: HashMap<String, String>,
}

impl Sweep {
    pub(super) fn new(_ctx: &Ctx) -> Sweep {
        Sweep {
            phase: Phase::Start,
            queue: Vec::new(),
            cap_queue: Vec::new(),
            trash: Vec::new(),
            orphans: Vec::new(),
            removed: Vec::new(),
            blocked: false,
            foreign_ok: false,
            dt: DevTimes::default(),
            unref: HashMap::new(),
            own_refs: HashSet::new(),
            all_refs: HashSet::new(),
            refs_gen: 0,
            newest_epoch: HashMap::new(),
        }
    }

    /// Runs until `budget` is spent (at least one unit of work per call). Returns true when the
    /// sweep is finished.
    pub(super) fn step(&mut self, ctx: &Ctx, budget: Duration) -> bool {
        self.step_with(ctx, budget, &retention::local_offset_secs)
    }

    pub(super) fn step_with(&mut self, ctx: &Ctx, budget: Duration, off: Off) -> bool {
        let t0 = Instant::now();
        let mut ex = Exec::new(ctx, usize::MAX);
        while self.phase != Phase::Done {
            self.unit(ctx, &mut ex, off);
            if t0.elapsed() >= budget {
                break;
            }
        }
        ex.finish();
        self.phase == Phase::Done
    }

    fn unit(&mut self, ctx: &Ctx, ex: &mut Exec, off: Off) {
        match self.phase {
            Phase::Start => {
                self.queue = rd(ctx.vh).lineages.values().flat_map(|l| l.versions.values()).filter(|e| e.name.dev == ctx.dev && e.head.is_none()).map(|e| e.name.id.clone()).collect();
                self.phase = Phase::Heads;
            }
            Phase::Heads => match self.queue.pop() {
                Some(id) => {
                    index::ensure_head(&ctx.vh.store, &ctx.vh.index, &id);
                }
                None => {
                    self.blocked = own_heads_missing(&rd(ctx.vh), ctx.dev);
                    self.queue = rd(ctx.vh).lineages.keys().cloned().collect();
                    self.phase = Phase::Retention;
                }
            },
            Phase::Retention => match self.queue.pop() {
                Some(lin) => {
                    ex.retain(&self.dt, off, &lin, false);
                }
                None => self.phase = Phase::Inputs,
            },
            Phase::Inputs => {
                let inp = lineage::sweep_inputs(ctx.vh, ctx.now_ms);
                self.trash = inp.trash_expired;
                self.orphans = inp.orphaned;
                self.phase = Phase::Trash;
            }
            Phase::Trash => match self.trash.pop() {
                Some(lin) => {
                    if names::is_ulid(&lin) && ex.purge_lineage(&lin).is_ok() {
                        self.removed.push(lin);
                    }
                }
                None => self.phase = Phase::Orphans,
            },
            Phase::Orphans => match self.orphans.pop() {
                Some(lin) => {
                    ex.retain(&self.dt, off, &lin, true);
                    self.removed.push(lin);
                }
                None => {
                    self.forget_removed(ctx);
                    self.phase = Phase::CapPlan;
                }
            },
            Phase::CapPlan => {
                let cap = cap_bytes(ctx.settings);
                let total = rd(ctx.vh).total_bytes();
                if cap > 0 && total > cap {
                    // Plan now, execute in chunks (the plan lists ids, the executor re-checks).
                    self.cap_queue = cap_plan_ids(ctx, total - cap);
                    self.cap_queue.reverse();
                }
                self.phase = Phase::CapExec;
            }
            Phase::CapExec => match self.cap_queue.pop() {
                Some((lin, id)) => {
                    ex.remove_version(&lin, &id);
                }
                None => self.phase = Phase::CapBlobs,
            },
            Phase::CapBlobs => {
                let cap = cap_bytes(ctx.settings);
                let total = rd(ctx.vh).total_bytes();
                if cap > 0 && total > cap && !self.blocked {
                    self.cap_blobs(ex, total - cap);
                }
                self.begin_own_blobs(ctx);
            }
            Phase::OwnBlobs => match self.queue.pop() {
                Some(key) => self.own_blob(ctx, ex, &key),
                None => self.phase = Phase::ForeignScan,
            },
            Phase::ForeignScan => {
                self.begin_foreign(ctx);
            }
            Phase::ForeignHeads => match self.queue.pop() {
                Some(id) => {
                    index::ensure_head(&ctx.vh.store, &ctx.vh.index, &id);
                }
                None => self.begin_foreign_exec(ctx),
            },
            Phase::Foreign => match self.queue.pop() {
                Some(key) => self.foreign_blob(ctx, ex, &key),
                None => self.finish(ctx),
            },
            Phase::Done => {}
        }
    }

    /// Lineages that no longer exist in the index lose their lineage state and trash mark.
    fn forget_removed(&mut self, ctx: &Ctx) {
        let gone: Vec<String> = {
            let g = rd(ctx.vh);
            self.removed.drain(..).filter(|l| !g.lineages.contains_key(l)).collect()
        };
        if gone.is_empty() {
            return;
        }
        {
            let mut g = wr(ctx.vh);
            for l in &gone {
                g.set_hidden(l, false);
            }
        }
        lineage::forget(ctx.vh, &gone);
    }

    /// Own unreferenced blobs, biggest first, until `excess` bytes are freed (cap emergency; the
    /// 1 h rule does not apply, but every own header must be known).
    fn cap_blobs(&mut self, ex: &mut Exec, mut excess: u64) {
        let cands: Vec<(u64, String)> = {
            let g = rd(ex.ctx.vh);
            if own_heads_missing(&g, ex.ctx.dev) {
                return;
            }
            let refs = own_refs(&g, ex.ctx.dev);
            let mut v: Vec<(u64, String)> = g
                .blobs
                .iter()
                .filter(|(k, _)| !refs.contains(*k))
                .map(|(k, copies)| (copies.iter().filter(|c| c.dev == ex.ctx.dev).map(|c| c.size).sum::<u64>(), k.clone()))
                .filter(|(s, _)| *s > 0)
                .collect();
            v.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
            v
        };
        let me = ex.ctx.dev.to_string();
        for (size, key) in cands {
            if excess == 0 {
                break;
            }
            ex.remove_blob_copies(&key, |c| c.dev == me);
            excess = excess.saturating_sub(size);
        }
    }

    fn begin_own_blobs(&mut self, ctx: &Ctx) {
        self.unref = std::mem::take(&mut super::lock(&ctx.vh.gc).unref_since);
        let g = rd(ctx.vh);
        self.own_refs = own_refs(&g, ctx.dev);
        self.refs_gen = g.refs_gen;
        self.queue = g.blobs.iter().filter(|(_, c)| c.iter().any(|c| c.dev == ctx.dev)).map(|(k, _)| k.clone()).collect();
        self.phase = Phase::OwnBlobs;
    }

    fn own_blob(&mut self, ctx: &Ctx, ex: &mut Exec, key: &str) {
        if self.blocked {
            return;
        }
        {
            // A version written between steps may reuse an own blob that was unreferenced at
            // the snapshot: refresh before trusting it.
            let g = rd(ctx.vh);
            if g.refs_gen != self.refs_gen {
                self.own_refs = own_refs(&g, ctx.dev);
                self.refs_gen = g.refs_gen;
            }
        }
        if self.own_refs.contains(key) {
            self.unref.remove(key);
            return;
        }
        let since = *self.unref.entry(key.to_string()).or_insert(ctx.now_ms);
        if ctx.now_ms.saturating_sub(since) >= OWN_BLOB_GRACE_MS {
            let me = ctx.dev;
            ex.remove_blob_copies(key, |c| c.dev == me);
            self.unref.remove(key);
        }
    }

    /// Foreign blob takeover (PLAN-H3 4.3): only if a device is unseen ≥ 30 d does any of this run.
    fn begin_foreign(&mut self, ctx: &Ctx) {
        let g = rd(ctx.vh);
        let unseen = |d: &str| g.devices.get(d).map_or(0, |t| ctx.now_ms.saturating_sub(*t));
        let any = g.blobs.values().flatten().any(|c| c.dev != ctx.dev && unseen(&c.dev) >= UNSEEN_MS);
        if !any {
            drop(g);
            self.finish(ctx);
            return;
        }
        self.queue = g.lineages.values().flat_map(|l| l.versions.values()).filter(|e| e.head.is_none()).map(|e| e.name.id.clone()).collect();
        drop(g);
        self.phase = Phase::ForeignHeads;
    }

    fn begin_foreign_exec(&mut self, ctx: &Ctx) {
        let g = rd(ctx.vh);
        // Every header must be known to claim "no header references this blob".
        self.foreign_ok = !g.lineages.values().flat_map(|l| l.versions.values()).any(|e| e.head.is_none());
        if !self.foreign_ok {
            drop(g);
            self.finish(ctx);
            return;
        }
        self.all_refs = all_refs(&g);
        self.refs_gen = g.refs_gen;
        self.newest_epoch.clear();
        for c in g.blobs.values().flatten() {
            let e = self.newest_epoch.entry(c.dev.clone()).or_default();
            if c.epoch > *e {
                *e = c.epoch.clone();
            }
        }
        self.queue = g.blobs.iter().filter(|(_, c)| c.iter().any(|c| c.dev != ctx.dev)).map(|(k, _)| k.clone()).collect();
        self.phase = Phase::Foreign;
    }

    fn foreign_blob(&mut self, ctx: &Ctx, ex: &mut Exec, key: &str) {
        let (pick, ok): (Vec<(String, String)>, bool) = {
            let g = rd(ctx.vh);
            let Some(copies) = g.blobs.get(key) else { return };
            if g.refs_gen != self.refs_gen {
                // Headers that arrived (or loaded) since the snapshot count too.
                if g.lineages.values().flat_map(|l| l.versions.values()).any(|e| e.head.is_none()) {
                    return;
                }
                self.all_refs = all_refs(&g);
                self.refs_gen = g.refs_gen;
            }
            // Only copies no known header references go (stricter than PLAN-H3 4.3 (b), which
            // also allowed it when this Mac has its own copy: own-blob GC only looks at own
            // headers, so that copy could go later and leave the foreign version without one).
            let ok = !self.all_refs.contains(key);
            let pick = copies
                .iter()
                .filter(|c| c.dev != ctx.dev)
                .filter(|c| {
                    let unseen = g.devices.get(&c.dev).map_or(0, |t| ctx.now_ms.saturating_sub(*t));
                    unseen >= DEAD_MS || (unseen >= UNSEEN_MS && self.newest_epoch.get(&c.dev).is_some_and(|e| *e != c.epoch))
                })
                .map(|c| (c.dev.clone(), c.epoch.clone()))
                .collect();
            (pick, ok)
        };
        if ok && !pick.is_empty() {
            ex.remove_blob_copies(key, |c| pick.iter().any(|(d, e)| *d == c.dev && *e == c.epoch));
        }
    }

    fn finish(&mut self, ctx: &Ctx) {
        let (total, checkpoints, own_keys) = {
            let g = rd(ctx.vh);
            let keys: HashSet<String> = g.blobs.iter().filter(|(_, c)| c.iter().any(|c| c.dev == ctx.dev)).map(|(k, _)| k.clone()).collect();
            (g.total_bytes(), g.checkpoint_bytes(), keys)
        };
        self.unref.retain(|k, _| own_keys.contains(k));
        let cap = cap_bytes(ctx.settings);
        let over_cap = if cap == 0 || total <= cap {
            "none"
        } else if checkpoints >= cap {
            "checkpoints"
        } else {
            "other-devices"
        };
        {
            let mut r = super::lock(&ctx.vh.gc);
            r.over_cap = over_cap;
            r.gc_blocked = self.blocked;
            r.unref_since = std::mem::take(&mut self.unref);
        }
        super::lock(&ctx.vh.notifier).status_changed();
        self.phase = Phase::Done;
    }
}

fn cap_plan_ids(ctx: &Ctx, excess: u64) -> Vec<(String, String)> {
    let g = rd(ctx.vh);
    let ids: Vec<&String> = g.lineages.keys().collect();
    let views: Vec<Vec<V>> = ids.iter().map(|k| view_of(&g.lineages[*k])).collect();
    let slices: Vec<&[V]> = views.iter().map(Vec::as_slice).collect();
    let (plan, _) = retention::plan_cap(&slices, excess, ctx.dev);
    plan.into_iter().map(|CapDelete { lineage, idx, .. }| (ids[lineage].clone(), views[lineage][idx].id.to_string())).collect()
}

/// Explicit user delete of one checkpoint (refused for anything that isn't a checkpoint).
pub(super) fn delete_checkpoint(ctx: &Ctx, id: &str) -> Result<()> {
    if !names::is_ulid(id) {
        return Err(err("INVALID_ARGUMENT", "Invalid version id"));
    }
    let (lin, name, path) = {
        let g = rd(ctx.vh);
        let Some((lin, e)) = g.entry(id) else { return Err(err("VERSION_GONE", "That version no longer exists")) };
        if e.reason() != names::Reason::Checkpoint || e.is_path_record() {
            return Err(err("INVALID_ARGUMENT", "Only checkpoints can be deleted one by one"));
        }
        let l = &g.lineages[lin];
        if l.versions.values().any(|o| o.keyframe_id() == Some(id)) {
            return Err(err("INVALID_ARGUMENT", "Other versions still depend on this checkpoint"));
        }
        (lin.to_string(), e.name.clone(), l.path.clone().unwrap_or_default())
    };
    let mut ex = Exec::new(ctx, usize::MAX);
    let ok = ex.unlink(&lin, &name, &path);
    ex.finish();
    if ok {
        Ok(())
    } else {
        Err(err("IO_ERROR", "The checkpoint could not be deleted"))
    }
}

/// "Delete all history of this drawing": every lineage of `path` (hidden ones too), every device,
/// checkpoints included. Returns the lineages removed.
pub(super) fn delete_all(ctx: &Ctx, path: &str) -> Result<Vec<String>> {
    crate::validate_relative(path)?;
    let lins: Vec<String> = rd(ctx.vh).all_lineages_for(path).into_iter().map(str::to_string).collect();
    purge(ctx, &lins)
}

/// Deletes every file of these lineages (N1 trash expiry; checkpoints included).
pub(super) fn delete_lineages(ctx: &Ctx, lineages: &[String]) -> Result<()> {
    if lineages.iter().any(|l| !names::is_ulid(l)) {
        return Err(err("INVALID_ARGUMENT", "Invalid lineage id"));
    }
    purge(ctx, lineages).map(|_| ())
}

fn purge(ctx: &Ctx, lins: &[String]) -> Result<Vec<String>> {
    let mut ex = Exec::new(ctx, usize::MAX);
    let mut first: Option<crate::NativeError> = None;
    for l in lins {
        if let Err(e) = ex.purge_lineage(l) {
            first.get_or_insert(e);
        }
    }
    ex.finish();
    let gone: Vec<String> = {
        let g = rd(ctx.vh);
        lins.iter().filter(|l| !g.lineages.contains_key(*l)).cloned().collect()
    };
    if !gone.is_empty() {
        {
            let mut g = wr(ctx.vh);
            for l in &gone {
                g.set_hidden(l, false);
            }
        }
        lineage::forget(ctx.vh, &gone);
    }
    match first {
        Some(e) => Err(e),
        None => Ok(gone),
    }
}
