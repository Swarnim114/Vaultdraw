//! The history worker: trigger logic (`Core`, pure of threads and clocks so it is unit-testable
//! with an injected clock and a fake `Backend`) plus the thread loop that drives it.
//!
//! Triggers (PLAN §2.2): timer (≥ interval since the last version AND ≥ 30 s idle, forced at 3×
//! interval; interval 0 = none), leave (via `history_opened`), shrink rule (x), checkpoint (c),
//! before-restore (r), first edit (f), startup catch-up of pending clones (v).
//! "Dirty" means our own committed revision that is not yet versioned (M2).

use super::{
    names::Reason,
    writer::{Backend, Clock, Outcome, Source, VersionRequest, Written},
    HistorySettings, SnapshotOutcome,
};
use crate::{err, Result};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{mpsc::Sender, Arc, Condvar, Mutex},
    time::Duration,
};

/// Idle time since the last commit before a timed version is made.
pub const IDLE_MS: u64 = 30_000;
/// Forced version after this many intervals of continuous editing.
pub const FORCE_FACTOR: u64 = 3;
pub const SHRINK_MIN_BYTES: u64 = 4096;
const RETRY_MIN_MS: u64 = 60_000;

/// Ordered (urgent) messages: everything that must be seen in the order it was sent.
pub enum Msg {
    Configure(HistorySettings),
    Opened { path: Option<String>, revision: Option<String> },
    Committed { path: String, revision: String, size: u64, staged: Option<PathBuf> },
    Snapshot { path: String, reason: Reason, ack: Option<Sender<Result<SnapshotOutcome>>> },
    Checkpoint { path: String, name: String, note: String, ack: Sender<Result<Written>> },
    Stop,
}

/// Background work, run in ≤ 5 ms chunks after the urgent queue is drained.
pub enum Task {
    /// Files appeared/changed under `history/` (sync, other instance): reconcile the index.
    Reconcile,
    /// Read these versions' headers (queued by `history_list`).
    LoadHeaders(Vec<String>),
}

#[derive(Default)]
struct InboxState {
    urgent: VecDeque<Msg>,
    bg: VecDeque<Task>,
    stop: bool,
}

/// Two queues behind one mutex + condvar: the save path pays a short lock and a notify.
#[derive(Default)]
pub struct Inbox {
    state: Mutex<InboxState>,
    cv: Condvar,
}

pub enum Popped {
    Msg(Msg),
    Task(Task),
    Timeout,
    Stop,
}

impl Inbox {
    pub fn send(&self, m: Msg) {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        s.urgent.push_back(m);
        drop(s);
        self.cv.notify_one();
    }
    pub fn send_task(&self, t: Task) {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        s.bg.push_back(t);
        drop(s);
        self.cv.notify_one();
    }
    pub fn stop(&self) {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).stop = true;
        self.cv.notify_all();
    }
    /// Next item: urgent first, then background; blocks up to `wait` (forever for `None`).
    /// `poll_only` = return `Timeout` instead of blocking (background chunks pending).
    pub fn pop(&self, wait: Option<Duration>, poll_only: bool) -> Popped {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        loop {
            if s.stop {
                return Popped::Stop;
            }
            if let Some(m) = s.urgent.pop_front() {
                return Popped::Msg(m);
            }
            if let Some(t) = s.bg.pop_front() {
                return Popped::Task(t);
            }
            if poll_only {
                return Popped::Timeout;
            }
            match wait {
                None => s = self.cv.wait(s).unwrap_or_else(|p| p.into_inner()),
                Some(d) => {
                    let (g, r) = self.cv.wait_timeout(s, d).unwrap_or_else(|p| p.into_inner());
                    s = g;
                    if r.timed_out() && s.urgent.is_empty() && s.bg.is_empty() && !s.stop {
                        return Popped::Timeout;
                    }
                }
            }
        }
    }
    pub fn urgent_pending(&self) -> bool {
        let s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        !s.urgent.is_empty() || s.stop
    }
}

/// A clone that survived a crash/quit: version it with reason `v`.
pub struct CatchUp {
    pub path: String,
    pub file: PathBuf,
    pub rev16: String,
}

#[derive(Clone, Debug)]
struct Pending {
    rev: String,
    size: u64,
    staged: Option<PathBuf>,
}

#[derive(Clone, Debug)]
struct OpenClone {
    file: PathBuf,
    rev: String,
    size: u64,
}

#[derive(Default)]
struct Track {
    pending: Option<Pending>,
    open_clone: Option<OpenClone>,
    /// Reference for the interval rule: time of the newest known version (or first dirty time).
    base_ms: Option<u64>,
    last_commit_ms: u64,
    retry_at: Option<u64>,
    first_done: bool,
    noted: bool,
}

pub struct Core<B: Backend> {
    pub b: B,
    clock: Arc<dyn Clock>,
    settings: Option<HistorySettings>,
    tracks: HashMap<String, Track>,
    open: Option<String>,
}

fn skipped(why: &str) -> SnapshotOutcome {
    SnapshotOutcome { id: None, skipped: Some(why.to_string()) }
}

impl<B: Backend> Core<B> {
    pub fn new(b: B, clock: Arc<dyn Clock>) -> Core<B> {
        Core { b, clock, settings: None, tracks: HashMap::new(), open: None }
    }

    /// Configured and enabled (unconfigured = off, Minor 3).
    pub fn on(&self) -> bool {
        self.settings.as_ref().is_some_and(|s| s.enabled)
    }
    pub fn is_configured(&self) -> bool {
        self.settings.is_some()
    }
    fn interval_ms(&self) -> u64 {
        self.settings.as_ref().map_or(0, |s| u64::from(s.interval_minutes) * 60_000)
    }
    pub fn is_dirty(&self, path: &str) -> bool {
        self.tracks.get(path).is_some_and(|t| t.pending.is_some())
    }
    pub fn tracked_pending(&self) -> usize {
        self.tracks.values().filter(|t| t.pending.is_some()).count()
    }

    pub fn configure(&mut self, s: HistorySettings) {
        let was_on = self.on();
        self.settings = Some(s);
        if was_on && !self.on() {
            // Disabled: stop tracking and free the clones (the live files hold every state).
            let tracks = std::mem::take(&mut self.tracks);
            for (_, t) in tracks {
                if let Some(p) = t.pending.and_then(|p| p.staged) {
                    self.b.remove_clone(&p);
                }
                if let Some(o) = t.open_clone {
                    self.b.remove_clone(&o.file);
                }
            }
        }
    }

    pub fn catch_up(&mut self, items: Vec<CatchUp>) {
        for it in items {
            if !self.on() {
                self.b.remove_clone(&it.file);
                continue;
            }
            let req = VersionRequest {
                path: it.path.clone(),
                reason: Reason::Recovered,
                name: None,
                note: None,
                source: Source::Clone(it.file.clone()),
                revision: None,
                size: None,
                verify: true,
                allow_unchanged: false,
                rev_prefix: Some(it.rev16.clone()),
            };
            match self.b.write(&req) {
                Ok(Outcome::Written(w)) => {
                    self.b.changed(&it.path, &w.lineage);
                    self.b.remove_clone(&it.file);
                }
                Ok(Outcome::DiskLow) => {
                    let keep = self.keep_set();
                    self.b.disk_low(&keep);
                }
                Ok(Outcome::Skipped("stopped")) => {}
                Ok(Outcome::Skipped(_)) => self.b.remove_clone(&it.file),
                Err(e) => self.b.error(&e.code, &e.message),
            }
        }
    }

    fn keep_set(&self) -> HashSet<PathBuf> {
        self.tracks.values().filter_map(|t| t.pending.as_ref().and_then(|p| p.staged.clone())).collect()
    }

    pub fn dispatch(&mut self, m: Msg) {
        match m {
            Msg::Configure(s) => self.configure(s),
            Msg::Opened { path, revision } => self.on_opened(path, revision),
            Msg::Committed { path, revision, size, staged } => self.on_committed(path, revision, size, staged),
            Msg::Snapshot { path, reason, ack } => {
                let r = self.snapshot(&path, reason);
                if let Some(a) = ack {
                    let _ = a.send(r);
                }
            }
            Msg::Checkpoint { path, name, note, ack } => {
                let _ = ack.send(self.checkpoint(&path, &name, &note));
            }
            Msg::Stop => {}
        }
    }

    fn request(&self, path: &str, reason: Reason, source: Source, revision: Option<String>, size: Option<u64>, verify: bool) -> VersionRequest {
        VersionRequest { path: path.to_string(), reason, name: None, note: None, source, revision, size, verify, allow_unchanged: false, rev_prefix: None }
    }

    /// Writes `req` and applies the bookkeeping common to every outcome. `Ok(Some)` = written.
    fn run(&mut self, req: &VersionRequest) -> Result<Outcome> {
        let out = self.b.write(req);
        match &out {
            Ok(Outcome::Written(w)) => {
                self.b.disk_ok();
                self.b.changed(&req.path, &w.lineage);
            }
            Ok(Outcome::DiskLow) => {
                let keep = self.keep_set();
                self.b.disk_low(&keep);
            }
            Err(e) => self.b.error(&e.code, &e.message),
            _ => {}
        }
        out
    }

    fn mark_versioned(&mut self, path: &str, now: u64) {
        if let Some(t) = self.tracks.get_mut(path) {
            if let Some(p) = t.pending.take() {
                if let Some(f) = p.staged {
                    self.b.remove_clone(&f);
                }
            }
            t.base_ms = Some(now);
            t.retry_at = None;
        }
    }

    /// Versions the latest pending state of `path`. Returns true when nothing is pending anymore.
    fn version_pending(&mut self, path: &str, reason: Reason) -> bool {
        let now = self.clock.now_ms();
        let Some(p) = self.tracks.get(path).and_then(|t| t.pending.clone()) else { return true };
        let source = p.staged.clone().map_or(Source::Live, Source::Clone);
        let req = self.request(path, reason, source, Some(p.rev), Some(p.size), false);
        match self.run(&req) {
            Ok(Outcome::Written(_)) => {
                self.mark_versioned(path, now);
                true
            }
            // Nothing left to do for this state: it is already versioned or no longer obtainable.
            Ok(Outcome::Skipped(why)) if why != "stopped" => {
                self.mark_versioned(path, now);
                true
            }
            Ok(Outcome::Skipped(_)) => false,
            Ok(Outcome::DiskLow) | Err(_) => {
                let retry = now + self.interval_ms().max(RETRY_MIN_MS);
                if let Some(t) = self.tracks.get_mut(path) {
                    t.retry_at = Some(retry);
                }
                false
            }
        }
    }

    pub fn on_opened(&mut self, path: Option<String>, revision: Option<String>) {
        if let Some(prev) = self.open.take() {
            self.leave(&prev);
        }
        self.open = path.clone();
        let (Some(path), Some(revision)) = (path, revision) else { return };
        if !self.on() {
            return;
        }
        if let Some(old) = self.tracks.entry(path.clone()).or_default().open_clone.take() {
            self.b.remove_clone(&old.file);
        }
        self.tracks.entry(path.clone()).or_default().first_done = false;
        self.b.note_path(&path);
        self.tracks.entry(path.clone()).or_default().noted = true;
        if let Some(file) = self.b.clone_open(&path, &revision) {
            let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            if let Some(t) = self.tracks.get_mut(&path) {
                t.open_clone = Some(OpenClone { file, rev: revision, size });
            }
        }
    }

    fn leave(&mut self, path: &str) {
        if self.on() && self.is_dirty(path) {
            self.version_pending(path, Reason::Leave);
        }
        let Some(t) = self.tracks.get_mut(path) else { return };
        if let Some(o) = t.open_clone.take() {
            self.b.remove_clone(&o.file);
        }
        if t.pending.is_none() {
            self.tracks.remove(path);
        }
    }

    pub fn on_committed(&mut self, path: String, revision: String, size: u64, staged: Option<PathBuf>) {
        if !self.on() {
            if let Some(f) = staged {
                self.b.remove_clone(&f);
            }
            return;
        }
        let now = self.clock.now_ms();
        if staged.is_some() && !self.tracks.get(&path).is_some_and(|t| t.noted) {
            self.b.note_path(&path);
            self.tracks.entry(path.clone()).or_default().noted = true;
        }
        let no_lineage = self.b.latest(&path).is_none();
        let (prev_pending, open) = {
            let t = self.tracks.entry(path.clone()).or_default();
            (t.pending.clone(), t.open_clone.clone())
        };
        // First edit (f): the drawing has no history yet, so its open-time state is the original.
        if no_lineage && !self.tracks.get(&path).is_some_and(|t| t.first_done) {
            if let Some(oc) = open.clone() {
                let req = self.request(&path, Reason::First, Source::Clone(oc.file.clone()), Some(oc.rev.clone()), Some(oc.size), true);
                if matches!(self.run(&req), Ok(Outcome::Written(_))) {
                    self.b.remove_clone(&oc.file);
                    if let Some(t) = self.tracks.get_mut(&path) {
                        t.open_clone = None;
                        t.base_ms = Some(now);
                    }
                }
            }
            if let Some(t) = self.tracks.get_mut(&path) {
                t.first_done = true;
            }
        } else if let Some((src_size, source, rev, vsize, verify)) = Self::previous_state(&prev_pending, &open) {
            // Shrink rule (x): a commit ≤ 50% of the previous state (previous ≥ 4 KB) versions the
            // previous state first (Cmd+Delete, select-all + Delete, paste-over, clear canvas).
            if src_size >= SHRINK_MIN_BYTES && size * 2 <= src_size {
                let req = self.request(&path, Reason::BeforeClear, source, Some(rev), Some(vsize), verify);
                if matches!(self.run(&req), Ok(Outcome::Written(_))) {
                    if let Some(t) = self.tracks.get_mut(&path) {
                        t.base_ms = Some(now);
                    }
                }
            }
        }
        let base_fallback = if self.tracks.get(&path).is_some_and(|t| t.base_ms.is_none()) { self.b.latest(&path).map(|l| l.created_ms).or(Some(now)) } else { None };
        let t = self.tracks.entry(path).or_default();
        if t.base_ms.is_none() {
            t.base_ms = base_fallback;
        }
        // Coalescing: only the latest pending clone is kept; superseded ones are deleted.
        let old = t.pending.replace(Pending { rev: revision, size, staged: staged.clone() });
        t.last_commit_ms = now;
        t.retry_at = None;
        if let Some(o) = old.and_then(|o| o.staged) {
            if Some(&o) != staged.as_ref() {
                self.b.remove_clone(&o);
            }
        }
    }

    /// The previous state a shrink can still version: the pending clone, else the open-time clone.
    #[allow(clippy::type_complexity)]
    fn previous_state(pending: &Option<Pending>, open: &Option<OpenClone>) -> Option<(u64, Source, String, u64, bool)> {
        if let Some(p) = pending {
            return p.staged.clone().map(|f| (p.size, Source::Clone(f), p.rev.clone(), p.size, false));
        }
        open.as_ref().map(|o| (o.size, Source::Clone(o.file.clone()), o.rev.clone(), o.size, true))
    }

    pub fn snapshot(&mut self, path: &str, reason: Reason) -> Result<SnapshotOutcome> {
        if !self.on() {
            return Ok(skipped("off"));
        }
        self.version_now(path, reason, None, None, false).map(|o| match o {
            Ok(w) => SnapshotOutcome { id: Some(w.id), skipped: None },
            Err(why) => skipped(why),
        })
    }

    pub fn checkpoint(&mut self, path: &str, name: &str, note: &str) -> Result<Written> {
        if !self.on() {
            return Err(err("HISTORY_OFF", "File history is turned off"));
        }
        match self.version_now(path, Reason::Checkpoint, Some(name.to_string()), Some(note.to_string()), true)? {
            Ok(w) => Ok(w),
            Err(why) => Err(err("IO_ERROR", format!("Checkpoint was not saved ({why})"))),
        }
    }

    /// Versions the current committed state of `path` (pending clone, else the live file).
    fn version_now(&mut self, path: &str, reason: Reason, name: Option<String>, note: Option<String>, allow_unchanged: bool) -> Result<std::result::Result<Written, &'static str>> {
        let now = self.clock.now_ms();
        let p = self.tracks.get(path).and_then(|t| t.pending.clone());
        let (source, rev, size) = match &p {
            Some(p) => (p.staged.clone().map_or(Source::Live, Source::Clone), Some(p.rev.clone()), Some(p.size)),
            None => (Source::Live, None, None),
        };
        let mut req = self.request(path, reason, source, rev, size, false);
        req.name = name;
        req.note = note;
        req.allow_unchanged = allow_unchanged;
        match self.run(&req)? {
            Outcome::Written(w) => {
                if p.is_some() {
                    self.mark_versioned(path, now);
                } else if let Some(t) = self.tracks.get_mut(path) {
                    t.base_ms = Some(now);
                }
                Ok(Ok(w))
            }
            Outcome::Skipped(why) => {
                if why == "unchanged" && p.is_some() {
                    self.mark_versioned(path, now);
                }
                Ok(Err(why))
            }
            Outcome::DiskLow => Err(err("HISTORY_DISK_LOW", "Free disk space is low; history is paused")),
        }
    }

    /// Next time a timer needs attention (ms, wall clock); `None` = nothing to wait for.
    pub fn next_deadline(&self) -> Option<u64> {
        if !self.on() {
            return None;
        }
        let interval = self.interval_ms();
        self.tracks
            .values()
            .filter(|t| t.pending.is_some())
            .filter_map(|t| {
                if let Some(r) = t.retry_at {
                    return Some(r);
                }
                if interval == 0 {
                    return None;
                }
                let base = t.base_ms.unwrap_or(t.last_commit_ms);
                let due = (base + interval).max(t.last_commit_ms + IDLE_MS);
                Some(due.min(base + FORCE_FACTOR * interval))
            })
            .min()
    }

    /// Runs every timer that is due.
    pub fn tick(&mut self) {
        if !self.on() {
            return;
        }
        let now = self.clock.now_ms();
        let due: Vec<String> = self
            .tracks
            .iter()
            .filter(|(_, t)| t.pending.is_some())
            .filter(|(_, t)| {
                let interval = self.interval_ms();
                let d = if let Some(r) = t.retry_at {
                    Some(r)
                } else if interval == 0 {
                    None
                } else {
                    let base = t.base_ms.unwrap_or(t.last_commit_ms);
                    Some(((base + interval).max(t.last_commit_ms + IDLE_MS)).min(base + FORCE_FACTOR * interval))
                };
                d.is_some_and(|d| d <= now)
            })
            .map(|(p, _)| p.clone())
            .collect();
        for p in due {
            self.version_pending(&p, Reason::Auto);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------------------------

use super::{index, staging, store, writer, HistoryEvent, ChangeEvent, VaultHistory};
use std::{path::Path, sync::atomic::Ordering, time::Instant};

const CHUNK: Duration = Duration::from_millis(5);
const STATE_SWEEP_MS: u64 = 90 * 24 * 3600 * 1000;

/// What the previous run left in the staged dir: clones to turn into `v` versions, files to drop.
#[derive(Default)]
pub struct Survivors {
    pub catch_up: Vec<CatchUp>,
    pub delete: Vec<PathBuf>,
}

/// Newest pending clone per drawing (attributed through its sidecar); everything else is dropped:
/// older clones, open-time clones (their editor is gone) and clones without a known drawing.
pub fn collect_survivors(staged_dir: &Path) -> Survivors {
    let mut out = Survivors::default();
    if writer::ensure_plain_dir(staged_dir).is_err() {
        return out;
    }
    let mut by_key: HashMap<String, Vec<staging::StagedFile>> = HashMap::new();
    for c in staging::list_clones(staged_dir) {
        if c.name.open {
            out.delete.push(c.path);
        } else {
            by_key.entry(c.name.key.clone()).or_default().push(c);
        }
    }
    for (key, mut files) in by_key {
        files.sort_by_key(|f| f.mtime);
        let newest = files.pop();
        out.delete.extend(files.into_iter().map(|f| f.path));
        match (newest, staging::read_sidecar(staged_dir, &key)) {
            (Some(f), Some(path)) => out.catch_up.push(CatchUp { path, file: f.path, rev16: f.name.rev16 }),
            (Some(f), None) => out.delete.push(f.path),
            _ => {}
        }
    }
    out
}

fn sweep_old_state(state_hist: &Path, keep: &str, now_ms: u64) {
    let Ok(rd) = std::fs::read_dir(state_hist) else { return };
    for e in rd.flatten() {
        let Ok(n) = e.file_name().into_string() else { continue };
        if n == keep || n.len() != 16 || !n.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        let touched = std::fs::metadata(e.path().join("last-opened")).or_else(|_| e.metadata()).ok().and_then(|m| m.modified().ok()).map_or(now_ms, crate::now_ms);
        if now_ms.saturating_sub(touched) > STATE_SWEEP_MS {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

fn flush_events(vh: &VaultHistory, force: bool) {
    let (change, status) = {
        let mut n = super::lock(&vh.notifier);
        if !force && n.due.is_none_or(|d| d > Instant::now()) {
            return;
        }
        n.due = None;
        let status = std::mem::take(&mut n.status_dirty);
        let change = std::mem::take(&mut n.change);
        let ev = ChangeEvent { handle: vh.handle.clone(), paths: std::mem::take(&mut n.paths).into_iter().collect(), lineages: std::mem::take(&mut n.lineages).into_iter().collect() };
        (change.then_some(ev), status)
    };
    if let Some(c) = change {
        (vh.emit)(HistoryEvent::Change(c));
    }
    if status {
        (vh.emit)(HistoryEvent::Status(vh.status()));
    }
}

fn save_index_if_due(vh: &VaultHistory, force: bool) {
    let due = {
        let n = super::lock(&vh.notifier);
        n.index_dirty_since.is_some_and(|t| force || t.elapsed() >= super::INDEX_SAVE_DELAY)
    };
    if due {
        super::lock(&vh.notifier).index_dirty_since = None;
        let _ = index::save(&vh.vault_state.join("index.bin"), &vh.read_index());
    }
}

/// The worker thread of one writable vault.
pub(crate) fn run(vh: Arc<VaultHistory>, survivors: Survivors, clock: Arc<dyn Clock>, free_probe: Option<Arc<dyn Fn() -> bool + Send + Sync>>) {
    crate::search::lower_priority();
    for f in &survivors.delete {
        staging::remove_clone(f);
    }
    vh.ensure_loaded();
    let now = clock.now_ms();
    index::scan_all(&vh.store, &vh.index, now);
    let _ = std::fs::write(vh.vault_state.join("last-opened"), b"");
    sweep_old_state(&vh.state_hist, &vh.vault_id, now);
    let _ = std::fs::create_dir_all(&vh.state_hist);
    let dev = match super::names::load_or_create_device(&vh.state_hist) {
        Ok(d) => d,
        Err(e) => {
            *super::lock(&vh.last_error) = Some(super::LastError { code: "IO_ERROR".into(), message: format!("History device id unavailable: {e}") });
            vh.flags.active.store(false, Ordering::Relaxed);
            return;
        }
    };
    store::cleanup_own_tmp(&vh.store, &dev, store::TMP_MAX_AGE);
    let ulid = super::names::UlidGen::load(Some(&vh.state_hist));
    let epoch = writer::Epoch::load(Some(vh.vault_state.join("writer")), now);
    let root = vh.store.root.clone();
    let free_ok: Box<dyn Fn() -> bool + Send> = match free_probe {
        Some(p) => Box::new(move || p()),
        None => Box::new(move || store::free_space_ok(&root)),
    };
    let (gen, my_gen) = (vh.gen.clone(), vh.my_gen);
    let is_current: Box<dyn Fn() -> bool + Send> = Box::new(move || gen.load(Ordering::SeqCst) == my_gen);
    let w = writer::Writer::new(vh.store.clone(), vh.index.clone(), dev, ulid, epoch, clock.clone(), free_ok, is_current);
    let (n1, n2, vh2) = (vh.notifier.clone(), vh.notifier.clone(), vh.clone());
    let backend = writer::RealBackend {
        writer: w,
        flags: vh.flags.clone(),
        staged_dir: vh.staged_dir.clone(),
        on_change: Box::new(move |p, l| super::lock(&n1).changed(p, l)),
        on_error: Box::new(move |e| {
            *super::lock(&vh2.last_error) = e.map(|(c, m)| super::LastError { code: c.into(), message: m.into() });
            super::lock(&n2).status_changed();
        }),
        writing: vh.writing.clone(),
    };
    let mut core = Core::new(backend, clock.clone());
    let mut survivors = Some(survivors.catch_up);
    let mut units: Vec<index::Unit> = Vec::new();
    loop {
        core.tick();
        flush_events(&vh, false);
        save_index_if_due(&vh, false);
        let now = clock.now_ms();
        let timer = core.next_deadline().map(|d| Duration::from_millis(d.saturating_sub(now)));
        let wait = match (timer, super::lock(&vh.notifier).wait()) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        match vh.inbox.pop(wait, !units.is_empty()) {
            Popped::Stop => break,
            Popped::Msg(Msg::Stop) => break,
            Popped::Msg(m) => {
                let configure = matches!(m, Msg::Configure(_));
                core.dispatch(m);
                if configure {
                    if let Some(items) = survivors.take() {
                        core.catch_up(items);
                    }
                }
            }
            Popped::Task(Task::Reconcile) => {
                units = index::plan_units(&vh.store, &vh.index);
            }
            Popped::Task(Task::LoadHeaders(mut ids)) => {
                let t0 = Instant::now();
                let mut loaded = false;
                while let Some(id) = ids.pop() {
                    loaded |= index::ensure_head(&vh.store, &vh.index, &id);
                    if t0.elapsed() >= CHUNK {
                        break;
                    }
                }
                if !ids.is_empty() {
                    vh.inbox.send_task(Task::LoadHeaders(ids));
                }
                if loaded {
                    super::lock(&vh.notifier).changed("", "");
                }
            }
            Popped::Timeout => {
                if !units.is_empty() && index::reconcile_chunk(&vh.store, &vh.index, &mut units, CHUNK, clock.now_ms()) {
                    super::lock(&vh.notifier).changed("", "");
                }
            }
        }
    }
    flush_events(&vh, true);
    save_index_if_due(&vh, true);
}
