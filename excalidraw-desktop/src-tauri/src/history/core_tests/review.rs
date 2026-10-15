//! Regression tests for the H1 review (QA agent): each test failed before its fix.
use super::support::*;
use crate::history::{
    names::{self, Reason},
    store::{fault, FaultKind, Step},
    worker::Core,
    writer::{Backend, Clock, Epoch, Latest, Outcome, Written},
};
use crate::Result;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

const P: &str = "a.excalidraw";
const MIN: u64 = 60_000;

// ---- Core-level harness (fake backend) ----

struct Fake {
    clock: Arc<TestClock>,
    dir: PathBuf,
    writes: Vec<crate::history::writer::VersionRequest>,
    latest: HashMap<String, Latest>,
    /// Answer every write with `Skipped("stopped")` (a superseded generation).
    stopped: bool,
}

impl Backend for Fake {
    fn latest(&mut self, path: &str) -> Option<Latest> {
        self.latest.get(path).cloned()
    }
    fn write(&mut self, req: &crate::history::writer::VersionRequest) -> Result<Outcome> {
        if self.stopped {
            return Ok(Outcome::Skipped("stopped"));
        }
        let rev = req.revision.clone().unwrap_or_else(|| "live".into());
        if self.latest.get(&req.path).is_some_and(|l| l.revision == rev) {
            return Ok(Outcome::Skipped("unchanged"));
        }
        self.writes.push(req.clone());
        self.latest.insert(req.path.clone(), Latest { revision: rev.clone(), created_ms: self.clock.now_ms() });
        Ok(Outcome::Written(Written { id: format!("id{}", self.writes.len()), lineage: "L".into(), revision: rev, bytes: 1 }))
    }
    fn remove_clone(&mut self, file: &Path) {
        let _ = fs::remove_file(file);
    }
    fn live_size(&mut self, file: &Path, raw: u64) -> u64 {
        let _ = file;
        raw
    }
    fn note_path(&mut self, _: &str) {}
    fn disk_low(&mut self, _: &HashSet<PathBuf>) {}
    fn disk_ok(&mut self) {}
    fn error(&mut self, _: &str, _: &str) {}
    fn changed(&mut self, _: &str, _: &str) {}
}

fn core() -> (Core<Fake>, Arc<TestClock>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let clock = TestClock::new(T0);
    let fake = Fake { clock: clock.clone(), dir: dir.path().to_path_buf(), writes: vec![], latest: HashMap::new(), stopped: false };
    let mut c = Core::new(fake, clock.clone());
    c.configure(settings(5));
    (c, clock, dir)
}

fn clone_file(dir: &Path, name: &str, len: usize) -> PathBuf {
    let p = dir.join(name);
    fs::write(&p, vec![b'x'; len]).unwrap();
    p
}

#[test]
fn shrink_rule_never_uses_a_stale_open_time_clone_once_a_commit_was_versioned() {
    let (mut c, clock, dir) = core();
    c.b.latest.insert(P.into(), Latest { revision: "v0".into(), created_ms: T0 });
    // open at r0 (10 KB), edit to r1 (20 KB), the timer versions r1
    let open = clone_file(&dir.path(), "o-r0", 10_000);
    c.on_opened(Some(P.into()), Some("r0".into()), Some(open));
    c.on_committed(P.into(), "r1".into(), 20_000, Some(clone_file(&dir.path(), "c-r1", 20_000)));
    clock.advance(6 * MIN);
    c.tick();
    assert_eq!(c.b.writes.len(), 1, "r1 versioned by the timer");
    // a small commit: r1 is already in history, r0 (10 KB) is a stale previous state
    c.on_committed(P.into(), "r2".into(), 2_000, Some(clone_file(&dir.path(), "c-r2", 2_000)));
    let reasons: Vec<_> = c.b.writes.iter().map(|w| (w.reason, w.revision.clone())).collect();
    assert_eq!(reasons, vec![(Reason::Auto, Some("r1".to_string()))], "no 'before clear' version of the stale open-time state");
}

#[test]
fn a_superseded_worker_does_not_spin_on_stopped_writes() {
    let (mut c, clock, dir) = core();
    c.on_committed(P.into(), "r1".into(), 100, Some(clone_file(dir.path(), "c-r1", 100)));
    c.b.stopped = true;
    clock.advance(10 * MIN);
    c.tick();
    let next = c.next_deadline().expect("the pending state still needs a retry");
    assert!(next > clock.now_ms(), "a retry delay, not an immediate re-run (busy loop)");
}

// ---- service level ----

#[test]
fn a_read_only_start_never_stops_or_blocks_the_writable_worker() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(41, 40, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    // the same service opens the same vault read-only (a second window: the lock is taken)
    let t0 = Instant::now();
    fx.svc.start("ro", fx.root.clone(), true, fx.emitter());
    assert!(t0.elapsed().as_millis() < 1000, "open_vault must not wait for the writer to finish");
    let v = fx.vh().checkpoint(P, "still writing", "").expect("the writer is still the current generation");
    assert_eq!(v.reason, "checkpoint");
    fx.svc.stop("ro");
    assert!(fx.vh().checkpoint(P, "after ro closed", "").is_ok());
}

#[test]
fn read_version_rejects_a_file_whose_header_names_another_version() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(51, 40, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    let a = fx.vh().checkpoint(P, "a", "").unwrap();
    // a synced copy of `a` under another id, in the same folder
    let dir = fx.hist_dir().join(&a.lineage);
    let src = fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).find(|p| p.file_name().unwrap().to_string_lossy().starts_with(&a.id)).unwrap();
    let name = names::VersionName::parse(src.file_name().unwrap().to_str().unwrap()).unwrap();
    let mut forged = name.clone();
    forged.id = names::UlidGen::load(None).next(crate::now_ms(std::time::SystemTime::now()) + 10_000);
    fs::copy(&src, dir.join(forged.format())).unwrap();
    crate::history::index::scan_all(&fx.vh().store, &fx.vh().index, T0);
    assert_eq!(fx.vh().read_version(&forged.id).unwrap_err().code, "VERSION_CORRUPT", "header id differs from the file name");
    assert!(fx.vh().read_version(&a.id).is_ok());
}

// ---- store / writer ----

#[test]
fn a_blob_temp_file_left_by_a_kill_does_not_block_the_retry() {
    let d = tempfile::tempdir().unwrap();
    let (root, state) = (d.path().join("v"), d.path().join("s"));
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&state).unwrap();
    let root = root.canonicalize().unwrap();
    let mut w = mk_writer(&root, &state, TestClock::new(T0), Box::new(|| true));
    let json = scene(61, 30, 1, 4000).json();
    fault::arm(Step::BlobRename, 0, FaultKind::Crash);
    assert!(version_of(&mut w, &root, P, &json, Reason::Auto).is_err());
    fault::clear();
    assert!(!tmp_files(&root).is_empty(), "the kill left the deterministic blob temp file");
    // relaunch within the 10 minute leftover window: the same blob must be writable again
    let out = version_of(&mut w, &root, P, &json, Reason::Auto).expect("retry must not hit the stale temp file");
    assert!(matches!(out, Outcome::Written(_)), "{out:?}");
    assert_eq!(verify_all_versions(&root), 1);
}

#[test]
fn new_history_folders_are_made_durable_by_full_sync_versions() {
    for (images, nth) in [(0usize, 1u32), (1, 3)] {
        let d = tempfile::tempdir().unwrap();
        let (root, state) = (d.path().join("v"), d.path().join("s"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&state).unwrap();
        let root = root.canonicalize().unwrap();
        let mut w = mk_writer(&root, &state, TestClock::new(T0), Box::new(|| true));
        // checkpoint = full sync: the content's directory fsync, plus one per new parent entry
        // (new lineage folder, new blob shard folder) that would otherwise vanish on power loss
        fault::arm(Step::DirSync, nth, FaultKind::Io);
        let r = version_of(&mut w, &root, P, &scene(71, 30, images, 3000).json(), Reason::Checkpoint);
        fault::clear();
        assert!(r.is_err(), "images={images}: the creation of new folders must be synced too");
    }
}

#[test]
fn the_epoch_clock_is_not_reset_by_starting_the_app_without_writing() {
    let d = tempfile::tempdir().unwrap();
    let f = d.path().join("writer");
    let day = 24 * 3600 * 1000u64;
    let e0 = Epoch::load(Some(f.clone()), T0).code;
    // starts (no history write) every 6 days, 12 days after the last real write
    assert_eq!(Epoch::load(Some(f.clone()), T0 + 6 * day).code, e0, "within the 7 days");
    let late = Epoch::load(Some(f.clone()), T0 + 12 * day).code;
    assert_ne!(late, e0, "more than 7 days after the last write: a new blob epoch");
}
