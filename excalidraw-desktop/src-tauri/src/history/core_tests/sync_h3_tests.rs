//! H3 tests (owner: agent Q3). See personal/feature/file-history/PLAN-H3.md.
//!
//! Multi-device simulation: every device is a full replica of the vault (own root, own state dir,
//! own device id, own clock, own `Writer` inside a `Core`), and a `Net` replicates the history
//! folder between replicas the way Dropbox/iCloud do: with lag, reordering across files, partial
//! files, no `.tmp` files, and deletions that propagate. A device with sync paused neither sends
//! nor receives.
use super::support::*;
use crate::history::{
    codec, gc::{self, Ctx, Sweep}, index, lineage,
    names::{self, BlobName, Reason, VersionName},
    retention::{DAY_MS, HOUR_MS},
    staging::Flags,
    worker::Core,
    writer::{Clock, Epoch, Outcome, RealBackend, Writer, Written},
    HistorySettings, VaultHistory,
};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

pub(super) const P: &str = "a.excalidraw";
const DAY: u64 = DAY_MS;

pub(super) fn off0(_: u64) -> i32 {
    0
}

/// Settings that never thin anything inside the first ~100 days when versions are at least an hour
/// apart (so "lost data" in a test can only come from a takeover or an explicit delete).
pub(super) fn generous() -> HistorySettings {
    HistorySettings { keep_all_hours: 720, keep_hourly_hours: 8760, keep_daily_days: 3650, keep_weekly_weeks: 0, size_cap_mb: 0, ..Default::default() }
}

// ---------------------------------------------------------------------------------------------
// A device
// ---------------------------------------------------------------------------------------------

pub(super) struct Dev {
    pub fx: Fx,
    pub vh: Arc<VaultHistory>,
    pub me: String,
    pub settings: HistorySettings,
    pub core: Core<RealBackend>,
}

impl Dev {
    pub fn new(t: u64) -> Dev {
        let fx = Fx::new();
        fx.start(true);
        let vh = fx.vh();
        vh.ensure_loaded();
        fs::create_dir_all(&vh.state_hist).unwrap();
        let me = names::load_or_create_device(&vh.state_hist).unwrap();
        fx.clock.0.store(t, Ordering::SeqCst);
        let w = Writer::new(vh.store.clone(), vh.index.clone(), me.clone(), names::UlidGen::load(None), Epoch::load(None, t), fx.clock.clone(), Box::new(|| true), Box::new(|| true));
        let flags = Arc::new(Flags::default());
        for f in [&flags.active, &flags.configured, &flags.enabled] {
            f.store(true, Ordering::Relaxed);
        }
        let staged_dir = fx.state.join("staged-sim");
        fs::create_dir_all(&staged_dir).unwrap();
        let backend = RealBackend { writer: w, flags, staged_dir, on_change: Box::new(|_, _| {}), on_error: Box::new(|_| {}), writing: Arc::default() };
        let mut core = Core::new(backend, fx.clock.clone() as Arc<dyn Clock>);
        let settings = HistorySettings::default();
        core.configure(settings.clone());
        Dev { fx, vh, me, settings, core }
    }
    pub fn with(mut self, s: HistorySettings) -> Dev {
        self.settings = s.clone();
        self.core.configure(s);
        self
    }
    pub fn at(&self, t: u64) {
        self.fx.clock.0.store(t, Ordering::SeqCst);
    }
    pub fn now(&self) -> u64 {
        self.fx.clock.now_ms()
    }
    pub fn root(&self) -> &Path {
        &self.fx.root
    }
    pub fn hist(&self) -> PathBuf {
        self.fx.hist_dir()
    }
    pub fn put(&mut self, path: &str, json: &str, reason: Reason) -> Written {
        match version_of(&mut self.core.b.writer, &self.fx.root, path, json, reason).unwrap() {
            Outcome::Written(w) => w,
            o => panic!("not written: {o:?}"),
        }
    }
    pub fn rescan(&self) {
        index::scan_all(&self.vh.store, &self.vh.index, self.now());
    }
    pub fn ctx(&self) -> Ctx<'_> {
        Ctx { vh: &self.vh, dev: &self.me, now_ms: self.now(), settings: &self.settings }
    }
    /// Orphan check (marks `orphan_since`).
    pub fn orphan_pass(&mut self) {
        let mut run = lineage::OrphanRun::new(&self.vh);
        let now = self.now();
        let vh = self.vh.clone();
        while !run.step(&vh, &mut self.core, now, Duration::from_secs(5)) {}
    }
    /// One full sweep at this device's clock.
    pub fn sweep(&mut self) {
        self.rescan();
        lineage::apply_hidden(&self.vh);
        let ctx = self.ctx();
        let mut s = Sweep::new(&ctx);
        while !s.step_with(&ctx, Duration::from_secs(5), &off0) {}
    }
    pub fn files(&self) -> BTreeMap<String, usize> {
        files_of(&self.hist())
    }
    /// Version files only (no blobs), as ids.
    pub fn version_ids(&self) -> BTreeSet<String> {
        self.files().keys().filter(|r| !r.starts_with("blobs/")).filter_map(|rel| rel.rsplit('/').next().and_then(VersionName::parse)).map(|n| n.id).collect()
    }
    pub fn blobs(&self) -> Vec<BlobName> {
        self.files().keys().filter_map(|rel| rel.strip_prefix("blobs/").and_then(|r| r.rsplit('/').next()).and_then(BlobName::parse)).collect()
    }
    pub fn lineages_on_disk(&self) -> Vec<String> {
        let Ok(rd) = fs::read_dir(self.hist()) else { return Vec::new() };
        rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| names::is_ulid(n)).collect()
    }
}

/// Byte-exact content of version `id` as the device would restore it.
pub(super) fn exact(d: &Dev, id: &str) -> Vec<u8> {
    let raw = d.vh.read_version(id).unwrap_or_else(|e| panic!("{id}: {} {}", e.code, e.message));
    let nl = raw.iter().position(|b| *b == b'\n').unwrap();
    codec::inline(&raw[nl + 1..], &|t| d.vh.read_blob(t)).unwrap_or_else(|e| panic!("{id}: inline {}", e.message))
}

fn files_of(hist: &Path) -> BTreeMap<String, usize> {
    fn walk(base: &Path, d: &Path, out: &mut BTreeMap<String, usize>) {
        let Ok(rd) = fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, out);
            } else if !e.file_name().to_string_lossy().ends_with(".tmp") {
                out.insert(p.strip_prefix(base).unwrap().to_string_lossy().into_owned(), fs::metadata(&p).map_or(0, |m| m.len() as usize));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(hist, hist, &mut out);
    out
}

// ---------------------------------------------------------------------------------------------
// The replicator
// ---------------------------------------------------------------------------------------------

enum Op {
    Put { to: usize, rel: String, bytes: Vec<u8>, half: bool },
    Del { to: usize, rel: String },
}
impl Op {
    fn key(&self) -> (usize, String) {
        match self {
            Op::Put { to, rel, .. } | Op::Del { to, rel } => (*to, rel.clone()),
        }
    }
}

pub(super) struct Net {
    known: Vec<HashMap<String, usize>>,
    pending: Vec<Op>,
    pub paused: Vec<bool>,
    rng: Rng,
}

impl Net {
    pub fn new(n: usize, seed: u64) -> Net {
        Net { known: vec![HashMap::new(); n], pending: Vec::new(), paused: vec![false; n], rng: Rng(seed | 1) }
    }
    pub fn pending(&self) -> usize {
        self.pending.len()
    }

    /// Queues what changed in each (unpaused) replica since the last time. Never `.tmp` files.
    /// Puts go blobs first, deletes go deltas, keyframes, blobs: the order the writer and GC use.
    pub fn detect(&mut self, devs: &[Dev]) {
        for i in 0..devs.len() {
            if self.paused[i] {
                continue;
            }
            let cur = devs[i].files();
            let mut puts: Vec<(String, Vec<u8>)> = Vec::new();
            for (rel, len) in &cur {
                if self.known[i].get(rel) != Some(len) {
                    if let Ok(bytes) = fs::read(devs[i].hist().join(rel)) {
                        puts.push((rel.clone(), bytes));
                        self.known[i].insert(rel.clone(), *len);
                    }
                }
            }
            let mut dels: Vec<String> = self.known[i].keys().filter(|r| !cur.contains_key(*r)).cloned().collect();
            for r in &dels {
                self.known[i].remove(r);
            }
            puts.sort_by_key(|(r, _)| (!r.starts_with("blobs/"), r.clone()));
            dels.sort_by_key(|r| (r.starts_with("blobs/"), r.contains(".k"), r.clone()));
            for j in (0..devs.len()).filter(|j| *j != i) {
                for (rel, bytes) in &puts {
                    self.pending.push(Op::Put { to: j, rel: rel.clone(), bytes: bytes.clone(), half: false });
                }
                for rel in &dels {
                    self.pending.push(Op::Del { to: j, rel: rel.clone() });
                }
            }
        }
    }

    fn apply(&mut self, devs: &[Dev], op: &Op, half: bool) {
        match op {
            Op::Put { to, rel, bytes, .. } => {
                let dst = devs[*to].hist().join(rel);
                fs::create_dir_all(dst.parent().unwrap()).unwrap();
                let data = if half { &bytes[..bytes.len() / 2] } else { &bytes[..] };
                fs::write(&dst, data).unwrap();
                self.known[*to].insert(rel.clone(), data.len());
            }
            Op::Del { to, rel } => {
                let dst = devs[*to].hist().join(rel);
                let _ = fs::remove_file(&dst);
                if let Some(parent) = dst.parent() {
                    if parent != devs[*to].hist() && parent.file_name().is_some_and(|n| n != "blobs") {
                        let _ = fs::remove_dir(parent); // only succeeds when empty
                    }
                }
                self.known[*to].remove(rel);
            }
        }
    }

    /// Delivers pending operations. `lag = Some(p)`: each file's queue advances with probability
    /// p percent per step, files are visited in random order (reordering across files, FIFO per
    /// file) and a put may arrive as a truncated file first. `None`: everything, in order.
    pub fn deliver(&mut self, devs: &[Dev], lag: Option<u64>) -> usize {
        let mut groups: Vec<VecDeque<Op>> = Vec::new();
        let mut at: HashMap<(usize, String), usize> = HashMap::new();
        for op in std::mem::take(&mut self.pending) {
            let i = *at.entry(op.key()).or_insert_with(|| {
                groups.push(VecDeque::new());
                groups.len() - 1
            });
            groups[i].push_back(op);
        }
        if lag.is_some() {
            for i in (1..groups.len()).rev() {
                let j = self.rng.below(i + 1);
                groups.swap(i, j);
            }
        }
        let mut delivered = 0;
        let mut keep: Vec<Op> = Vec::new();
        for mut q in groups {
            while let Some(op) = q.pop_front() {
                let to = op.key().0;
                if self.paused[to] || lag.is_some_and(|p| (self.rng.below(100) as u64) >= p) {
                    q.push_front(op);
                    break;
                }
                if let (Some(_), Op::Put { to, rel, bytes, half: false }) = (lag, &op) {
                    if bytes.len() > 8 && self.rng.below(100) < 30 {
                        // a truncated copy arrives first, the rest later
                        let partial = Op::Put { to: *to, rel: rel.clone(), bytes: bytes.clone(), half: true };
                        self.apply(devs, &partial, true);
                        q.push_front(partial);
                        break;
                    }
                }
                self.apply(devs, &op, false);
                delivered += 1;
            }
            keep.extend(q);
        }
        self.pending = keep;
        delivered
    }

    /// Delivers the first `n` pending operations in order (a consistent past state of the source).
    pub fn deliver_prefix(&mut self, devs: &[Dev], n: usize) {
        let n = n.min(self.pending.len());
        let rest = self.pending.split_off(n);
        let first = std::mem::replace(&mut self.pending, rest);
        let mut blocked = Vec::new();
        for op in first {
            if self.paused[op.key().0] {
                blocked.push(op);
            } else {
                self.apply(devs, &op, false);
            }
        }
        blocked.append(&mut self.pending);
        self.pending = blocked;
    }

    pub fn rescan_all(devs: &[Dev]) {
        for d in devs {
            d.rescan();
        }
    }

    pub fn sync(&mut self, devs: &[Dev], lag: Option<u64>) {
        self.detect(devs);
        self.deliver(devs, lag);
        Net::rescan_all(devs);
    }

    /// Everything delivered, nothing left to detect (paused devices stay behind).
    pub fn quiesce(&mut self, devs: &[Dev]) {
        for _ in 0..50 {
            self.detect(devs);
            if self.deliver(devs, None) == 0 {
                break;
            }
        }
        Net::rescan_all(devs);
    }
}

/// Sweeps every device and replicates until the file sets stop changing.
pub(super) fn settle(devs: &mut [Dev], net: &mut Net) {
    let mut last: Vec<BTreeMap<String, usize>> = Vec::new();
    for _ in 0..8 {
        for d in devs.iter_mut() {
            d.sweep();
        }
        net.quiesce(devs);
        let now: Vec<_> = devs.iter().map(|d| d.files()).collect();
        if now == last {
            return;
        }
        last = now;
    }
}

fn all_valid(devs: &[Dev]) -> usize {
    devs.iter().map(|d| verify_all_versions(d.root())).sum()
}

fn keyframes_of(d: &Dev, dev: &str) -> Vec<String> {
    d.files().keys().filter(|r| r.contains(&format!("-{dev}.k"))).cloned().collect()
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

#[test]
fn replicator_drops_tmp_files_and_propagates_deletes() {
    let mut devs = [Dev::new(T0), Dev::new(T0)];
    let mut net = Net::new(2, 1);
    let sc = scene(1, 30, 1, 2000);
    let w = devs[0].put(P, &sc.json(), Reason::Auto);
    fs::write(devs[0].hist().join(&w.lineage).join(".junk-zzzzzzzz.ka.vdh.tmp"), b"x").unwrap();
    net.quiesce(&devs);
    assert_eq!(devs[1].version_ids().len(), 1);
    assert!(tmp_files(devs[1].root()).is_empty(), ".tmp files are not replicated");
    assert_eq!(exact(&devs[1], &w.id), sc.json().as_bytes());
    // a delete propagates, and the empty lineage folder goes with it
    let name = fs::read_dir(devs[0].hist().join(&w.lineage)).unwrap().flatten().find_map(|e| VersionName::parse(&e.file_name().to_string_lossy())).unwrap();
    fs::remove_file(devs[0].hist().join(&w.lineage).join(name.format())).unwrap();
    net.quiesce(&devs);
    assert!(devs[1].version_ids().is_empty());
}

/// Different retention on the two devices: after syncing and sweeping on both, no delta lacks its
/// keyframe, every version decodes byte-exact and the two replicas hold the same files.
#[test]
fn different_retention_settings_converge_without_orphaned_deltas() {
    let aggressive = HistorySettings { keep_all_hours: 1, keep_hourly_hours: 2, keep_daily_days: 3, keep_weekly_weeks: 2, size_cap_mb: 0, ..Default::default() };
    let mut devs = [Dev::new(T0).with(aggressive), Dev::new(T0).with(generous())];
    let mut net = Net::new(2, 7);
    let mut sc = scene(3, 80, 1, 3000);
    let mut written = 0;
    for day in 0..20u64 {
        for rep in 0..6u64 {
            let i = ((day + rep) % 2) as usize;
            let t = T0 + day * DAY + rep * 4 * HOUR_MS;
            devs.iter().for_each(|d| d.at(t));
            sc.edit();
            devs[i].put(P, &sc.json(), Reason::Auto);
            written += 1;
            net.sync(&devs, Some(60));
        }
    }
    net.quiesce(&devs);
    let end = T0 + 21 * DAY;
    devs.iter().for_each(|d| d.at(end));
    settle(&mut devs, &mut net);
    assert!(tmp_files(devs[0].root()).is_empty() && tmp_files(devs[1].root()).is_empty());
    let checked = all_valid(&devs);
    assert!(checked > 0 && checked / 2 < written, "thinned: {} of {written}", checked / 2);
    assert_eq!(devs[0].files(), devs[1].files(), "the union converged on both replicas");
    for d in &devs {
        let l = d.vh.list(P).unwrap();
        assert_eq!(exact(d, &l.versions[0].id), sc.json().as_bytes());
    }
}

fn b1_offline(days: u64) {
    let mut devs = [Dev::new(T0).with(generous()), Dev::new(T0).with(generous())];
    let mut net = Net::new(2, 11 + days);
    let mut sc = scene(11, 60, 1, 4000);
    for i in 0..3 {
        devs[0].at(T0 + i * HOUR_MS);
        sc.edit();
        devs[0].put(P, &sc.json(), Reason::Auto);
    }
    net.quiesce(&devs);
    let mut scb = sc.clone();
    scb.rng = Rng(0x5eed_b);
    devs[1].at(T0 + 4 * HOUR_MS);
    scb.edit();
    let b0 = devs[1].put(P, &scb.json(), Reason::Auto);
    net.quiesce(&devs);
    let me_b = devs[1].me.clone();
    let epoch0: BTreeSet<String> = devs[1].blobs().into_iter().filter(|b| b.dev == me_b).map(|b| b.epoch).collect();
    net.paused[1] = true;
    for day in 1..=days {
        devs[0].at(T0 + day * DAY);
        sc.edit();
        devs[0].put(P, &sc.json(), Reason::Auto);
        devs[0].sweep();
        net.sync(&devs, Some(70));
    }
    // B returns: it edits and writes a version that reuses image X (new epoch: > 7 days)
    let tb = T0 + days * DAY + 2 * HOUR_MS;
    devs[1].at(tb);
    scb.edit();
    let b1 = devs[1].put(P, &scb.json(), Reason::Auto);
    let b_epochs: BTreeSet<String> = devs[1].blobs().into_iter().filter(|b| b.dev == me_b).map(|b| b.epoch).collect();
    assert!(b_epochs.len() > epoch0.len(), "B started a new epoch after {days} days offline: {epoch0:?} -> {b_epochs:?}");
    // A sweeps again right before the replicas merge: B is unseen for `days` days here
    devs[0].at(tb);
    devs[0].sweep();
    net.paused[1] = false;
    net.quiesce(&devs);
    devs.iter().for_each(|d| d.at(tb + HOUR_MS));
    settle(&mut devs, &mut net);
    all_valid(&devs);
    for d in &devs {
        assert!(d.version_ids().contains(&b0.id) && d.version_ids().contains(&b1.id), "B's versions are on both replicas");
        assert_eq!(exact(d, &b1.id), scb.json().as_bytes(), "B's newest version restores byte-exact");
    }
}

#[test]
fn b1_device_offline_10_days_reuses_image_and_restores_byte_exact() {
    b1_offline(10);
}

#[test]
fn b1_device_offline_31_days_starts_a_new_epoch_and_restores_byte_exact() {
    b1_offline(31);
}

/// M8: devices whose clocks are +40 d and -40 d off never have their files taken over wrongly,
/// whatever the observer's clock does later.
#[test]
fn m8_clock_skew_of_plus_and_minus_40_days_is_never_taken_over() {
    let mut devs = [Dev::new(T0).with(generous()), Dev::new(T0 + 40 * DAY).with(generous()), Dev::new(T0 - 40 * DAY).with(generous())];
    let mut net = Net::new(3, 5);
    let mut sc = scene(5, 40, 1, 3000);
    for round in 0..9u64 {
        let i = (round % 3) as usize;
        let base = T0 + round * 2 * HOUR_MS;
        devs[0].at(base);
        devs[1].at(base + 40 * DAY);
        devs[2].at(base - 40 * DAY);
        sc.edit();
        devs[i].put(P, &sc.json(), Reason::Auto);
        net.sync(&devs, Some(80));
    }
    net.quiesce(&devs);
    let (ahead, behind) = (devs[1].me.clone(), devs[2].me.clone());
    let kfs = |d: &Dev| (keyframes_of(d, &ahead).len(), keyframes_of(d, &behind).len());
    let before = kfs(&devs[0]);
    assert!(before.0 >= 1 && before.1 >= 1);
    // The observer's clock runs on; the skewed devices never show up again. At +35 d both are
    // unseen >= 30 d by local observation, yet neither moved past its keyframes and neither is dead.
    for days in [35u64, 60, 100, 170] {
        devs[0].at(T0 + days * DAY);
        devs[0].sweep();
        assert_eq!(kfs(&devs[0]), before, "skewed devices' keyframes survive a sweep at +{days} d");
        verify_all_versions(devs[0].root());
    }
    // A device returning after 31+ days writes a new keyframe, whatever its clock says.
    devs[2].at(T0 - 40 * DAY + 31 * DAY);
    let w = devs[2].put(P, &{ sc.edit(); sc.json() }, Reason::Auto);
    let name = devs[2].vh.read_index().entry(&w.id).unwrap().1.name.clone();
    assert!(name.is_keyframe(), "after > 7 days the writer starts a new keyframe");
}

/// M8: a device returning after 31 days writes no delta against a keyframe another Mac took over.
#[test]
fn m8_returning_device_never_deltas_against_a_taken_over_keyframe() {
    // default settings: after 30 days only the newest version per week is kept
    let mut devs = [Dev::new(T0), Dev::new(T0)];
    let mut net = Net::new(2, 21);
    let mut sc = scene(21, 50, 1, 3000);
    // day 0: B writes K. day 1: A writes (same lineage, same week: K is not the week's newest).
    devs[1].at(T0 + 10 * HOUR_MS);
    sc.edit();
    let k = devs[1].put(P, &sc.json(), Reason::Auto);
    net.quiesce(&devs);
    devs[0].at(T0 + DAY);
    sc.edit();
    devs[0].put(P, &sc.json(), Reason::Auto);
    net.quiesce(&devs);
    // day 8: B writes K2 (so it "moved past" K), then B goes away.
    devs[1].at(T0 + 8 * DAY);
    devs[0].at(T0 + 8 * DAY);
    sc.edit();
    let k2 = devs[1].put(P, &sc.json(), Reason::Auto);
    net.quiesce(&devs);
    net.paused[1] = true;
    let k_file = devs[0].files().keys().find(|r| r.contains(&k.id)).cloned().unwrap();
    // A carries on until day 45: B unseen 37 d, K 45 d old, unreferenced, not kept, B moved past it.
    for day in 9..=45u64 {
        devs[0].at(T0 + day * DAY);
        sc.edit();
        devs[0].put(P, &sc.json(), Reason::Auto);
        if day % 5 == 0 || day == 45 {
            devs[0].sweep();
        }
        net.sync(&devs, Some(80));
    }
    assert!(!devs[0].files().contains_key(&k_file), "A took over B's old keyframe");
    assert!(devs[0].version_ids().contains(&k2.id), "B's newer keyframe is still protected");
    // B returns after 37 days away: its writer must start a new keyframe
    devs[1].at(T0 + 46 * DAY);
    sc.edit();
    let back = devs[1].put(P, &sc.json(), Reason::Auto);
    assert!(devs[1].vh.read_index().entry(&back.id).unwrap().1.name.is_keyframe(), "no delta against K or K2");
    net.paused[1] = false;
    net.quiesce(&devs);
    devs.iter().for_each(|d| d.at(T0 + 47 * DAY));
    settle(&mut devs, &mut net);
    all_valid(&devs);
    for d in &devs {
        assert_eq!(exact(d, &back.id), sc.json().as_bytes());
    }
}

/// D-H3-2/3: B keeps writing with sync paused for 35 days, A sees nothing new from B and sweeps;
/// after reconnecting none of B's versions has lost its keyframe or blobs.
#[test]
fn paused_sync_for_35_days_then_reconnect_loses_nothing_of_b() {
    let mut devs = [Dev::new(T0).with(generous()), Dev::new(T0).with(generous())];
    let mut net = Net::new(2, 31);
    let mut sc = scene(31, 50, 2, 3000);
    sc.edit();
    devs[0].put(P, &sc.json(), Reason::Auto);
    net.quiesce(&devs);
    let mut scb = sc.clone();
    scb.rng = Rng(0x5eed_b);
    devs[1].at(T0 + 2 * HOUR_MS);
    scb.edit();
    let mut b_ids = vec![devs[1].put(P, &scb.json(), Reason::Auto).id];
    net.quiesce(&devs);
    net.paused[1] = true;
    for day in 1..=35u64 {
        let t = T0 + day * DAY;
        devs[0].at(t);
        devs[1].at(t + 3 * HOUR_MS);
        sc.edit();
        devs[0].put(P, &sc.json(), Reason::Auto);
        scb.edit();
        b_ids.push(devs[1].put(P, &scb.json(), Reason::Auto).id);
        devs[0].sweep();
        devs[1].sweep();
        net.sync(&devs, Some(80));
    }
    net.paused[1] = false;
    net.quiesce(&devs);
    devs.iter().for_each(|d| d.at(T0 + 36 * DAY));
    settle(&mut devs, &mut net);
    all_valid(&devs);
    for d in &devs {
        let have = d.version_ids();
        for id in &b_ids {
            assert!(have.contains(id), "B's version {id} survived on both replicas");
        }
        assert_eq!(exact(d, b_ids.last().unwrap()), scb.json().as_bytes());
    }
}

/// A device unseen for >= 180 days is dead: its old files are taken over.
#[test]
fn dead_device_unseen_180_days_gets_its_old_files_taken_over() {
    // default settings: after 30 days only the newest version per week is kept
    let mut devs = [Dev::new(T0), Dev::new(T0)];
    let mut net = Net::new(2, 41);
    let mut sc = scene(41, 40, 1, 3000);
    devs[1].at(T0 + 10 * HOUR_MS);
    sc.edit();
    let k = devs[1].put(P, &sc.json(), Reason::Auto);
    net.quiesce(&devs);
    // A's version has no image: no known header references B's blob copy once K is gone
    devs[0].at(T0 + DAY);
    devs[0].put(P, &scene(42, 40, 0, 0).json(), Reason::Auto);
    net.quiesce(&devs);
    net.paused[1] = true;
    let k_file = devs[0].files().keys().find(|r| r.contains(&k.id)).cloned().unwrap();
    let me_b = devs[1].me.clone();
    assert!(devs[0].blobs().iter().any(|b| b.dev == me_b));
    devs[0].at(T0 + 100 * DAY);
    devs[0].sweep();
    assert!(devs[0].files().contains_key(&k_file), "unseen 100 d: still protected");
    devs[0].at(T0 + 200 * DAY);
    devs[0].sweep();
    assert!(!devs[0].files().contains_key(&k_file), "unseen 200 d: dead, taken over");
    assert_eq!(devs[0].blobs().iter().filter(|b| b.dev == me_b).count(), 0, "its blob copies go once no known header references them");
    verify_all_versions(devs[0].root());
}

fn trash_setup() -> ([Dev; 2], Net, Vec<String>, String, String) {
    let mut devs = [Dev::new(T0).with(generous()), Dev::new(T0).with(generous())];
    let mut net = Net::new(2, 51);
    let mut sc = scene(51, 40, 1, 3000);
    let mut ids = Vec::new();
    let mut first = String::new();
    for i in 0..3u64 {
        devs[0].at(T0 + i * HOUR_MS);
        sc.edit();
        let w = devs[0].put(P, &sc.json(), Reason::Auto);
        if i == 0 {
            first = sc.json();
        }
        ids.push(w.id);
    }
    let lin = devs[0].vh.read_index().lineages_for(P)[0].to_string();
    net.quiesce(&devs);
    // B still edits the drawing before A's trash reaches it
    for i in 0..3u64 {
        devs[1].at(T0 + 10 * HOUR_MS + i * HOUR_MS);
        sc.edit();
        ids.push(devs[1].put(P, &sc.json(), Reason::Auto).id);
    }
    // A moves the drawing to the Trash (7-day window starts)
    devs[0].at(T0 + 12 * HOUR_MS);
    fs::remove_file(devs[0].root().join(P)).unwrap();
    let vh = devs[0].vh.clone();
    lineage::apply_trashed(&vh, &mut devs[0].core, P);
    lineage::save_if_dirty(&vh);
    assert!(vh.list(P).unwrap().versions.is_empty(), "hidden on A");
    net.quiesce(&devs);
    (devs, net, ids, lin, first)
}

#[test]
fn trash_resurrection_b_edits_survive_and_put_back_within_7_days_restores_everything() {
    let (mut devs, mut net, ids, lin, first) = trash_setup();
    assert!(devs[0].vh.read_index().hidden.contains(&lin));
    // day 3: both sweep; nothing of B's is lost, nothing is deleted anywhere
    devs.iter().for_each(|d| d.at(T0 + 3 * DAY));
    settle(&mut devs, &mut net);
    for d in &devs {
        for id in &ids {
            assert!(d.version_ids().contains(id), "{id} still there at day 3");
        }
    }
    all_valid(&devs);
    assert_eq!(devs[1].vh.list(P).unwrap().versions.len(), ids.len(), "B still shows its history");
    // Put Back on A (day 3): the bytes are one of the lineage's revisions
    fs::write(devs[0].root().join(P), &first).unwrap();
    let now = devs[0].now();
    let vh = devs[0].vh.clone();
    lineage::reattach_at(&vh, &mut devs[0].core, P, now);
    assert!(!vh.read_index().hidden.contains(&lin));
    assert_eq!(vh.list(P).unwrap().versions.len(), ids.len(), "all versions, B's included, are back on A");
    // and later sweeps never expire it
    devs[0].at(T0 + 40 * DAY);
    devs[0].sweep();
    assert!(devs[0].lineages_on_disk().contains(&lin));
    assert!(ids.iter().all(|id| devs[0].version_ids().contains(id)));
}

#[test]
fn trash_expiry_after_7_days_removes_the_lineage_on_both_devices() {
    let (mut devs, mut net, ids, lin, _) = trash_setup();
    devs.iter().for_each(|d| d.at(T0 + 6 * DAY + 20 * HOUR_MS));
    settle(&mut devs, &mut net);
    for d in &devs {
        assert!(ids.iter().all(|id| d.version_ids().contains(id)), "inside the window nothing goes");
    }
    devs.iter().for_each(|d| d.at(T0 + 8 * DAY));
    settle(&mut devs, &mut net);
    for d in &devs {
        assert!(!d.lineages_on_disk().contains(&lin), "expired: the lineage is gone on {}", d.me);
        assert!(d.vh.read_index().lineages.get(&lin).is_none());
    }
}

/// M7: an orphan lineage with checkpoints keeps them after 30 days on both devices.
#[test]
fn m7_orphan_lineage_keeps_checkpoints_on_both_devices_after_30_days() {
    let mut devs = [Dev::new(T0).with(generous()), Dev::new(T0).with(generous())];
    let mut net = Net::new(2, 61);
    let mut sc = scene(61, 40, 1, 3000);
    let mut cp = Vec::new();
    for i in 0..6u64 {
        devs.iter().for_each(|d| d.at(T0 + i * HOUR_MS));
        sc.edit();
        let reason = if i == 2 { Reason::Checkpoint } else { Reason::Auto };
        let w = devs[(i % 2) as usize].put(P, &sc.json(), reason);
        if i == 2 {
            cp.push((w.id, sc.json()));
        }
        net.quiesce(&devs);
    }
    for d in &devs {
        fs::remove_file(d.root().join(P)).unwrap();
    }
    let t0 = T0 + 10 * DAY;
    for d in devs.iter_mut() {
        d.at(t0);
        d.orphan_pass();
    }
    let total = devs[0].version_ids().len();
    devs.iter().for_each(|d| d.at(t0 + 29 * DAY));
    settle(&mut devs, &mut net);
    assert_eq!(devs[0].version_ids().len(), total, "29 days: not orphaned long enough");
    devs.iter().for_each(|d| d.at(t0 + 31 * DAY));
    settle(&mut devs, &mut net);
    all_valid(&devs);
    for d in &devs {
        assert!(d.version_ids().contains(&cp[0].0), "the checkpoint stays on {}", d.me);
        assert_eq!(exact(d, &cp[0].0), cp[0].1.as_bytes());
        assert!(d.version_ids().len() < total, "automatic versions of the orphan went");
    }
    assert_eq!(devs[0].files(), devs[1].files());
}

/// Delete all history of a drawing on A: every lineage of the path is gone on disk, the other
/// device converges, and its own blobs go at its next sweep (after the 1 h unreferenced rule).
#[test]
fn delete_all_removes_every_lineage_and_the_other_device_converges() {
    let mut devs = [Dev::new(T0).with(generous()), Dev::new(T0).with(generous())];
    let mut net = Net::new(2, 71);
    let mut sc = scene(71, 40, 1, 3000);
    // two lineages: concurrent first edits (nothing synced yet), then a merge
    sc.edit();
    devs[0].put(P, &sc.json(), Reason::First);
    devs[1].at(T0 + 1000);
    sc.edit();
    devs[1].put(P, &sc.json(), Reason::First);
    net.quiesce(&devs);
    assert_eq!(devs[0].vh.read_index().lineages_for(P).len(), 2);
    for i in 1..5u64 {
        devs.iter().for_each(|d| d.at(T0 + i * HOUR_MS));
        sc.edit();
        devs[(i % 2) as usize].put(P, &sc.json(), Reason::Auto);
        net.quiesce(&devs);
    }
    devs[0].put("other.excalidraw", &scene(72, 10, 0, 0).json(), Reason::Auto);
    net.quiesce(&devs);
    assert_eq!(devs[0].lineages_on_disk().len(), 3);
    let gone = gc::delete_all(&devs[0].ctx(), P).unwrap();
    assert_eq!(gone.len(), 2);
    net.quiesce(&devs);
    for d in &devs {
        assert_eq!(d.lineages_on_disk().len(), 1, "only the other drawing's lineage remains on {}", d.me);
        assert!(d.vh.list(P).unwrap().versions.is_empty());
    }
    let t = T0 + DAY;
    devs.iter().for_each(|d| d.at(t));
    settle(&mut devs, &mut net);
    devs.iter().for_each(|d| d.at(t + 2 * HOUR_MS));
    settle(&mut devs, &mut net);
    // the other drawing has no image, so every blob belonged to the deleted drawing
    let left: Vec<String> = devs[0].blobs().iter().map(|b| b.format()).collect();
    assert!(left.is_empty(), "blobs left: {left:?}");
    assert_eq!(devs[0].files(), devs[1].files());
    all_valid(&devs);
}

// ---------------------------------------------------------------------------------------------
// Crash during GC concurrent with replication
// ---------------------------------------------------------------------------------------------

pub(super) fn history_pair(seed: u64, n: usize) -> ([Dev; 2], Net, String) {
    let mut devs = [Dev::new(T0), Dev::new(T0)];
    let mut net = Net::new(2, seed);
    let mut sc = scene(seed, 25, 1, 2000);
    let mut lin = String::new();
    for i in 0..n as u64 {
        let t = T0 + i * 20 * 60_000;
        devs.iter().for_each(|d| d.at(t));
        sc.edit();
        // B joins for the second half (its own keyframes and blobs)
        let who = if i >= (n as u64) / 2 && i % 3 == 0 { 1 } else { 0 };
        lin = devs[who].put(P, &sc.json(), Reason::Auto).lineage;
        if i % 10 == 9 {
            net.quiesce(&devs);
        }
    }
    net.quiesce(&devs);
    (devs, net, lin)
}

/// Interrupt the delete sequence after k unlinks, replicate a consistent prefix of what happened
/// so far (in order), then resume. A's replica is valid at every instant; B's is valid at every
/// prefix; both converge afterwards.
#[test]
fn crash_after_every_kth_unlink_while_replicating_keeps_every_replica_decodable() {
    let end = T0 + 40 * HOUR_MS;
    let mut unlinked = 0;
    for k in [0usize, 1, 2, 3, 5, 8, 13, 21, 34, 55] {
        let (devs, mut net, lin) = history_pair(100 + k as u64, 130);
        devs.iter().for_each(|d| d.at(end));
        let before = devs[0].version_ids().len();
        let done = gc::retain_with(&devs[0].ctx(), &lin, &off0, k);
        assert!(done <= k);
        unlinked += done;
        verify_all_versions(devs[0].root());
        net.detect(&devs);
        let n = net.pending();
        for cut in [n / 3, n / 2, n] {
            net.deliver_prefix(&devs, cut);
            devs[1].rescan();
            verify_all_versions(devs[1].root());
        }
        // A restarts and finishes in small steps, replicating between the steps
        loop {
            let d = gc::retain_with(&devs[0].ctx(), &lin, &off0, 3);
            verify_all_versions(devs[0].root());
            net.detect(&devs);
            let n = net.pending();
            net.deliver_prefix(&devs, n / 2 + 1);
            devs[1].rescan();
            verify_all_versions(devs[1].root());
            if d == 0 {
                break;
            }
        }
        net.quiesce(&devs);
        assert!(devs[0].version_ids().len() < before, "k={k}: thinning ran");
        assert_eq!(devs[0].files(), devs[1].files(), "k={k}: converged");
        assert_eq!(all_valid(&devs) / 2, devs[0].version_ids().len());
    }
    assert!(unlinked > 0);
}

/// The whole sweep (with foreign and blob phases), abandoned after a few units and restarted
/// while the replicator copies and the other device keeps writing.
#[test]
fn sweep_abandoned_at_every_unit_with_concurrent_writes_and_replication() {
    let (mut devs, mut net, _lin) = history_pair(200, 90);
    let end = T0 + 40 * HOUR_MS;
    devs.iter().for_each(|d| d.at(end));
    let mut sc = scene(201, 25, 1, 2000);
    let mut units = 0usize;
    let mut restarts = 0usize;
    for round in 0..12usize {
        devs[0].rescan();
        let mut sweep = Sweep::new(&devs[0].ctx());
        let stop_after = 1 + round * 3;
        let mut i = 0;
        loop {
            let done = sweep.step_with(&devs[0].ctx(), Duration::ZERO, &off0);
            units += 1;
            i += 1;
            verify_all_versions(devs[0].root());
            if i % 4 == 0 {
                devs[1].at(end + (units as u64) * HOUR_MS);
                sc.edit();
                devs[1].put(P, &sc.json(), Reason::Auto);
            }
            net.detect(&devs);
            let n = net.pending();
            net.deliver_prefix(&devs, n / 2 + 1);
            devs[0].rescan();
            devs[1].rescan();
            if done {
                break;
            }
            if i >= stop_after {
                restarts += 1;
                break; // crash: the Sweep value is dropped, a new one starts next round
            }
        }
    }
    net.quiesce(&devs);
    devs.iter().for_each(|d| d.at(end + 2 * DAY));
    settle(&mut devs, &mut net);
    all_valid(&devs);
    assert_eq!(devs[0].files(), devs[1].files());
    assert!(restarts > 0 && units > 12);
}
