//! Trigger logic of `Core` with an injected clock and a fake `Backend` (no threads, no disk
//! beyond a few placeholder clone files).
use super::support::*;
use crate::history::{
    names::Reason,
    worker::{Core, Inbox, Msg, Popped, Task, IDLE_MS},
    writer::{Backend, Clock, Latest, Outcome, Source, VersionRequest, Written},
    HistorySettings,
};
use crate::Result;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};

const MIN: u64 = 60_000;

struct Fake {
    clock: Arc<TestClock>,
    dir: PathBuf,
    writes: Vec<VersionRequest>,
    latest: HashMap<String, Latest>,
    removed: Vec<PathBuf>,
    open_size: u64,
    next: u32,
    disk_low_calls: u32,
    live_rev: Option<String>,
    live_sizes: HashMap<PathBuf, u64>,
}

impl Backend for Fake {
    fn latest(&mut self, path: &str) -> Option<Latest> {
        self.latest.get(path).cloned()
    }
    fn write(&mut self, req: &VersionRequest) -> Result<Outcome> {
        let rev = req.revision.clone().or_else(|| self.live_rev.clone()).unwrap_or_else(|| format!("live{}", self.next));
        if !req.allow_unchanged && self.latest.get(&req.path).is_some_and(|l| l.revision == rev) {
            return Ok(Outcome::Skipped("unchanged"));
        }
        self.next += 1;
        self.writes.push(req.clone());
        self.latest.insert(req.path.clone(), Latest { revision: rev.clone(), created_ms: self.clock.now_ms() });
        Ok(Outcome::Written(Written { id: format!("id{}", self.next), lineage: "L".into(), revision: rev, bytes: 1 }))
    }
    fn remove_clone(&mut self, file: &Path) {
        self.removed.push(file.to_path_buf());
    }
    fn disk_low(&mut self, _keep: &HashSet<PathBuf>) {
        self.disk_low_calls += 1;
    }
    fn live_size(&mut self, file: &Path, raw: u64) -> u64 {
        self.live_sizes.get(file).copied().unwrap_or(raw)
    }
    fn note_path(&mut self, _: &str) {}
    fn disk_ok(&mut self) {}
    fn error(&mut self, _: &str, _: &str) {}
    fn changed(&mut self, _: &str, _: &str) {}
}

struct H {
    core: Core<Fake>,
    clock: Arc<TestClock>,
    _dir: tempfile::TempDir,
}

fn harness(interval: u32) -> H {
    let dir = tempfile::tempdir().unwrap();
    let clock = TestClock::new(T0);
    let fake = Fake { clock: clock.clone(), dir: dir.path().to_path_buf(), writes: vec![], latest: HashMap::new(), removed: vec![], open_size: 10_000, next: 0, disk_low_calls: 0, live_rev: None, live_sizes: HashMap::new() };
    let mut core = Core::new(fake, clock.clone());
    core.configure(settings(interval));
    H { core, clock, _dir: dir }
}

impl Fake {
    fn open_clone(&self, path: &str, revision: &str) -> PathBuf {
        let p = self.dir.join(format!("o-{}-{}", path.replace('/', "_"), &revision[..4.min(revision.len())]));
        std::fs::write(&p, vec![0u8; self.open_size as usize]).unwrap();
        p
    }
}

impl H {
    fn open(&mut self, path: Option<&str>, rev: Option<&str>) {
        let clone = match (path, rev) {
            (Some(p), Some(r)) => Some(self.core.b.open_clone(p, r)),
            _ => None,
        };
        self.core.on_opened(path.map(Into::into), rev.map(Into::into), clone);
    }
    fn commit(&mut self, path: &str, rev: &str, size: u64) -> PathBuf {
        let f = self._dir.path().join(format!("c-{rev}"));
        std::fs::write(&f, b"x").unwrap();
        self.core.on_committed(path.into(), rev.into(), size, Some(f.clone()));
        f
    }
    fn reasons(&self) -> Vec<Reason> {
        self.core.b.writes.iter().map(|w| w.reason).collect()
    }
    fn seed_version(&mut self, path: &str, rev: &str) {
        self.core.b.latest.insert(path.into(), Latest { revision: rev.into(), created_ms: self.clock.now_ms() });
    }
}

const P: &str = "a.excalidraw";

#[test]
fn unconfigured_is_off_and_nothing_is_written_or_kept() {
    let dir = tempfile::tempdir().unwrap();
    let clock = TestClock::new(T0);
    let mut core = Core::new(Fake { clock: clock.clone(), dir: dir.path().into(), writes: vec![], latest: HashMap::new(), removed: vec![], open_size: 1, next: 0, disk_low_calls: 0, live_rev: None, live_sizes: HashMap::new() }, clock.clone());
    assert!(!core.on());
    core.on_opened(Some(P.into()), Some("r".repeat(64)), None);
    let f = dir.path().join("c");
    std::fs::write(&f, b"x").unwrap();
    core.on_committed(P.into(), "r1".into(), 5000, Some(f.clone()));
    assert!(!core.is_dirty(P));
    assert!(core.next_deadline().is_none());
    core.tick();
    assert!(core.b.writes.is_empty());
    assert_eq!(core.b.removed, vec![f], "a stray clone is dropped");
    assert!(core.snapshot(P, Reason::Leave).unwrap().skipped.is_some());
    assert_eq!(core.checkpoint(P, "n", "").unwrap_err().code, "HISTORY_OFF");
}

#[test]
fn timer_needs_interval_and_idle_and_is_forced_at_three_intervals() {
    let mut h = harness(5);
    h.seed_version(P, "v0");
    h.commit(P, "r1", 5000);
    h.clock.advance(MIN);
    h.core.tick();
    assert!(h.core.b.writes.is_empty(), "interval not reached");
    h.clock.advance(4 * MIN);
    h.commit(P, "r2", 5000); // activity right before the interval ends
    h.core.tick();
    assert!(h.core.b.writes.is_empty(), "not idle for 30 s yet");
    h.clock.advance(IDLE_MS - 1);
    h.core.tick();
    assert!(h.core.b.writes.is_empty());
    h.clock.advance(1);
    h.core.tick();
    assert_eq!(h.reasons(), vec![Reason::Auto]);
    assert_eq!(h.core.b.writes[0].revision.as_deref(), Some("r2"), "the latest pending state is versioned");
    assert!(!h.core.is_dirty(P));
    assert!(h.core.next_deadline().is_none(), "idle: nothing to wait for");

    // continuous editing: a commit every 20 s never goes idle, so the 3x rule forces a version
    let mut t = 0;
    let mut n = 3;
    while h.core.b.writes.len() < 2 && t < 20 * MIN {
        h.clock.advance(20_000);
        t += 20_000;
        h.commit(P, &format!("r{n}"), 5000);
        n += 1;
        h.core.tick();
    }
    assert_eq!(h.core.b.writes.len(), 2);
    assert!(t >= 15 * MIN - 20_000 && t <= 15 * MIN + 20_000, "forced at 3x interval, got {t}");
}

#[test]
fn interval_zero_means_no_timed_versions() {
    let mut h = harness(0);
    h.seed_version(P, "v0");
    h.core.on_opened(Some(P.into()), None, None);
    h.commit(P, "r1", 5000);
    assert!(h.core.next_deadline().is_none());
    h.clock.advance(1000 * MIN);
    h.core.tick();
    assert!(h.core.b.writes.is_empty());
    h.core.on_opened(None, None, None);
    assert_eq!(h.reasons(), vec![Reason::Leave], "leave still versions");
}

#[test]
fn leave_versions_a_dirty_drawing_only() {
    let mut h = harness(5);
    h.seed_version(P, "v0");
    h.open(Some(P), Some(&"v0".repeat(32)));
    h.open(Some("b.excalidraw"), Some(&"e".repeat(64)));
    assert!(h.core.b.writes.is_empty(), "opening and leaving an untouched drawing versions nothing");
    h.seed_version("b.excalidraw", "v0");
    h.commit("b.excalidraw", "r1", 9000);
    h.open(Some(P), Some(&"d".repeat(64)));
    assert_eq!(h.reasons(), vec![Reason::Leave]);
    assert_eq!(h.core.b.writes[0].path, "b.excalidraw");
}

#[test]
fn unchanged_content_is_skipped_and_clears_dirty() {
    let mut h = harness(5);
    h.seed_version(P, "r1");
    h.core.on_opened(Some(P.into()), None, None);
    h.commit(P, "r2", 5000);
    h.commit(P, "r1", 5000); // back to the versioned content
    h.core.on_opened(None, None, None);
    assert!(h.core.b.writes.is_empty());
    assert!(!h.core.is_dirty(P));
}

#[test]
fn only_own_commits_make_a_drawing_dirty() {
    let mut h = harness(5);
    for i in 0..500 {
        h.core.on_opened(Some(format!("d{}.excalidraw", i % 7)), Some("a".repeat(64)), None);
    }
    h.core.on_opened(None, None, None);
    assert_eq!(h.core.tracked_pending(), 0);
    assert!(h.core.b.writes.is_empty());
    assert!(h.core.next_deadline().is_none());
}

#[test]
fn first_edit_versions_the_open_time_state() {
    let mut h = harness(5);
    let rev = "f".repeat(64);
    h.open(Some(P), Some(&rev.clone()));
    h.commit(P, "r1", 9000);
    assert_eq!(h.reasons(), vec![Reason::First]);
    let w = &h.core.b.writes[0];
    assert!(matches!(w.source, Source::Clone(_)));
    assert_eq!(w.revision.as_deref(), Some(rev.as_str()));
    assert!(w.verify, "the open-time clone is verified against the opened revision");
    h.commit(P, "r2", 9000);
    assert_eq!(h.core.b.writes.len(), 1, "only the first edit");
    // a drawing that already has history gets no f version
    let mut h = harness(5);
    h.seed_version(P, "old");
    h.open(Some(P), Some(&rev));
    h.commit(P, "r1", 9000);
    assert!(h.core.b.writes.is_empty());
}

#[test]
fn shrink_rule_versions_the_previous_state_first() {
    // clear canvas / select-all+Delete / paste-over: the commit is <= 50% of the previous state
    for (prev, now, expect) in [(20_000u64, 9_000u64, true), (20_000, 10_000, true), (20_000, 10_001, false), (4096, 100, true), (4095, 10, false), (100_000, 60_000, false)] {
        let mut h = harness(5);
        h.seed_version(P, "v0");
        h.commit(P, "r1", prev);
        h.commit(P, "r2", now);
        let reasons = h.reasons();
        assert_eq!(reasons == vec![Reason::BeforeClear], expect, "prev {prev} now {now}");
        if expect {
            assert_eq!(h.core.b.writes[0].revision.as_deref(), Some("r1"), "the previous state, not the new one");
        }
    }
    // the open-time state is the previous state of the first commit
    let mut h = harness(5);
    h.seed_version(P, "v0");
    h.core.b.open_size = 30_000;
    h.open(Some(P), Some(&"c".repeat(64)));
    h.commit(P, "r1", 100);
    assert_eq!(h.reasons(), vec![Reason::BeforeClear]);
    // without a clone of the previous state nothing can be versioned
    let mut h = harness(5);
    h.core.on_committed(P.into(), "r1".into(), 50_000, None);
    h.core.on_committed(P.into(), "r2".into(), 10, None);
    assert!(h.core.b.writes.is_empty());
}

#[test]
fn shrink_rule_compares_live_size_so_tombstones_do_not_hide_a_cleared_canvas() {
    // Cmd+Delete keeps every element as an isDeleted tombstone: the raw file barely shrinks.
    let mut h = harness(5);
    h.seed_version(P, "v0");
    let c1 = h.commit(P, "r1", 100_000);
    h.core.b.live_sizes.insert(c1, 100_000);
    let f = h._dir.path().join("c-r2");
    std::fs::write(&f, b"x").unwrap();
    h.core.b.live_sizes.insert(f.clone(), 3_000); // raw 98 KB, live 3 KB
    h.core.on_committed(P.into(), "r2".into(), 98_000, Some(f));
    assert_eq!(h.reasons(), vec![Reason::BeforeClear]);
    assert_eq!(h.core.b.writes[0].revision.as_deref(), Some("r1"));
    // the same raw sizes without tombstone knowledge do not fire
    let mut h = harness(5);
    h.seed_version(P, "v0");
    h.commit(P, "r1", 100_000);
    h.core.on_committed(P.into(), "r2".into(), 98_000, None);
    assert!(h.core.b.writes.is_empty());
}

#[test]
fn coalescing_deletes_superseded_clones_and_versions_the_latest() {
    let mut h = harness(5);
    h.seed_version(P, "v0");
    let c1 = h.commit(P, "r1", 5000);
    let c2 = h.commit(P, "r2", 5000);
    let c3 = h.commit(P, "r3", 5000);
    assert!(h.core.b.removed.contains(&c1) && h.core.b.removed.contains(&c2) && !h.core.b.removed.contains(&c3));
    h.clock.advance(6 * MIN);
    h.core.tick();
    assert_eq!(h.core.b.writes.len(), 1);
    assert_eq!(h.core.b.writes[0].revision.as_deref(), Some("r3"));
    assert!(h.core.b.removed.contains(&c3), "the versioned clone is freed");
}

#[test]
fn checkpoint_and_before_restore_are_immediate() {
    let mut h = harness(5);
    h.seed_version(P, "v0");
    h.commit(P, "r1", 5000);
    let w = h.core.checkpoint(P, "Milestone", "note").unwrap();
    assert_eq!(h.core.b.writes[0].reason, Reason::Checkpoint);
    assert_eq!(h.core.b.writes[0].name.as_deref(), Some("Milestone"));
    assert!(h.core.b.writes[0].allow_unchanged);
    assert_eq!(w.revision, "r1");
    assert!(!h.core.is_dirty(P));
    // a checkpoint of unchanged content is still written; a before-restore snapshot is not
    h.core.b.live_rev = Some("r1".into());
    h.core.checkpoint(P, "Again", "").unwrap();
    assert_eq!(h.core.b.writes.len(), 2);
    let o = h.core.snapshot(P, Reason::BeforeRestore).unwrap();
    assert!(o.id.is_none() && o.skipped.as_deref() == Some("unchanged"));
    h.commit(P, "r2", 5000);
    let o = h.core.snapshot(P, Reason::BeforeRestore).unwrap();
    assert!(o.id.is_some());
    assert_eq!(h.core.b.writes[2].reason, Reason::BeforeRestore);
}

#[test]
fn disabling_drops_clones_and_stops_everything() {
    let mut h = harness(5);
    h.seed_version(P, "v0");
    let c = h.commit(P, "r1", 5000);
    h.core.configure(HistorySettings { enabled: false, ..settings(5) });
    assert!(h.core.b.removed.contains(&c));
    assert!(!h.core.is_dirty(P));
    h.commit(P, "r2", 5000);
    h.core.on_opened(None, None, None);
    assert!(h.core.b.writes.is_empty());
}

#[test]
fn urgent_messages_are_drained_before_background_work() {
    let inbox = Inbox::default();
    inbox.send_task(Task::Reconcile);
    inbox.send_task(Task::LoadHeaders(vec![]));
    inbox.send(Msg::Opened { path: None, revision: None, clone: None });
    inbox.stop();
    assert!(matches!(inbox.pop(None, false), Popped::Stop), "stop wins");
    let inbox = Inbox::default();
    inbox.send_task(Task::Reconcile);
    inbox.send(Msg::Opened { path: None, revision: None, clone: None });
    assert!(matches!(inbox.pop(None, true), Popped::Msg(Msg::Opened { .. })));
    assert!(matches!(inbox.pop(None, true), Popped::Task(Task::Reconcile)));
    assert!(matches!(inbox.pop(None, true), Popped::Timeout), "poll mode never blocks");
    assert!(matches!(inbox.pop(Some(std::time::Duration::from_millis(5)), false), Popped::Timeout));
}
