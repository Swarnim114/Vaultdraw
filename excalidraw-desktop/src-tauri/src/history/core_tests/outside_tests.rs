//! H3 outside-change tests (owner: agent I): watcher identity checks, `history_snapshot_bytes`,
//! pre-rewrite states of link updates, scratch-file cleanup, scheduling. See PLAN-H3.md §4.5/4.6.
use super::lineage_tests::{control_rename, disk_rev, exact, make_history, save_exp, wait_control, watch, A};
use super::support::*;
use crate::history::{
    names::Reason,
    outside,
    store,
    worker::{Inbox, Msg, Popped, Task},
    SnapshotOutcome,
};
use crate::Result;
use std::{fs, time::{Duration, Instant, SystemTime}};

const P: &str = "p.excalidraw";
const BEFORE: &str = "before-outside-change";

fn all_staged(fx: &Fx) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(fx.vh().staged_dir.clone()).map(|rd| rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| !n.ends_with(".path")).collect()).unwrap_or_default();
    v.sort();
    v
}

fn set_mtime(path: &std::path::Path, t: SystemTime) {
    fs::OpenOptions::new().write(true).open(path).unwrap().set_modified(t).unwrap();
}

fn snap(fx: &Fx, path: &str, reason: &str, body: &str) -> Result<SnapshotOutcome> {
    outside::snapshot_bytes(&fx.vh(), path, reason, &crate::revision(body.as_bytes()), body.as_bytes())
}

#[test]
fn clonefile_keeps_the_source_mtime_so_our_own_echo_is_recognised_without_a_hash() {
    let d = tempfile::tempdir().unwrap();
    let (src, dst) = (d.path().join("s.excalidraw"), d.path().join("c.excalidraw"));
    fs::write(&src, b"hello").unwrap();
    let old = SystemTime::now() - Duration::from_secs(3600);
    set_mtime(&src, old);
    match store::clone_file(&src, &dst) {
        Ok(()) => {
            let (a, b) = (fs::metadata(&src).unwrap(), fs::metadata(&dst).unwrap());
            eprintln!("clonefile mtime preserved: {}", a.modified().unwrap() == b.modified().unwrap());
            assert_eq!(a.modified().unwrap(), b.modified().unwrap(), "clonefile must keep mtime (identity check relies on it)");
            assert_eq!(a.len(), b.len());
        }
        Err(e) => eprintln!("clonefile unsupported here ({e}); identity falls back to hashing"),
    }
}

#[test]
fn outside_change_on_an_open_drawing_versions_the_old_state_byte_exact() {
    let fx = Fx::new();
    fx.start_configured(5);
    // The file exists before history knows it: only an open-time clone is staged.
    let j0 = scene(1, 60, 0, 0).json();
    fs::write(fx.root.join(P), &j0).unwrap();
    fx.open(Some(P));
    assert_eq!(fx.staged_files().len(), 1);
    fs::write(fx.root.join(P), scene(2, 10, 0, 0).json()).unwrap();
    watch(&fx, &[P]);
    let vs = fx.versions(P);
    assert_eq!(vs.len(), 1);
    assert_eq!(vs[0].reason, BEFORE);
    assert_eq!(exact(&fx, &vs[0].id), j0.as_bytes());
    assert!(fx.staged_files().is_empty(), "the open clone is settled");
    watch(&fx, &[P]);
    assert_eq!(fx.versions(P).len(), 1, "a second event for the same change adds nothing");
}

#[test]
fn outside_change_on_a_closed_drawing_with_a_pending_clone_versions_the_old_state() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    let j0 = scene(3, 60, 0, 0).json();
    fx.save(P, &j0);
    assert_eq!(fx.staged_files().len(), 1);
    fs::write(fx.root.join(P), scene(4, 70, 0, 0).json()).unwrap();
    watch(&fx, &[P]);
    let vs = fx.versions(P);
    assert_eq!(vs.len(), 1);
    assert_eq!(vs[0].reason, BEFORE);
    assert_eq!(exact(&fx, &vs[0].id), j0.as_bytes());
    assert!(fx.staged_files().is_empty());
}

#[test]
fn same_size_different_bytes_is_caught_by_the_hash() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    let j0 = scene(5, 60, 0, 0).json();
    fx.save(P, &j0);
    let changed = j0.replacen("rectangle", "rectangl3", 1);
    assert_eq!(changed.len(), j0.len());
    fs::write(fx.root.join(P), &changed).unwrap();
    set_mtime(&fx.root.join(P), SystemTime::now() + Duration::from_secs(30));
    watch(&fx, &[P]);
    let vs = fx.versions(P);
    assert_eq!(vs.len(), 1);
    assert_eq!(exact(&fx, &vs[0].id), j0.as_bytes());
}

#[test]
fn own_echo_and_a_touch_create_no_version() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (_, _) = make_history(&fx, A, 1);
    fx.open(Some(A));
    let mut sc = scene(7, 40, 0, 0);
    sc.edit();
    save_exp(&fx, A, &sc.json(), Some(&disk_rev(&fx, A)));
    fx.barrier();
    let n = fx.versions(A).len();
    assert_eq!(fx.staged_files().len(), 1);
    for _ in 0..3 {
        watch(&fx, &[A]);
    }
    assert_eq!(fx.versions(A).len(), n, "our own save echoes");
    // Same bytes, new mtime (touch, a backup tool, git rewriting an identical file): still nothing.
    set_mtime(&fx.root.join(A), SystemTime::now() + Duration::from_secs(60));
    watch(&fx, &[A]);
    assert_eq!(fx.versions(A).len(), n);
    assert_eq!(fx.staged_files().len(), 1, "the pending state is still pending");
}

#[test]
fn a_500_file_pull_versions_only_drawings_that_have_clones() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    fs::create_dir(fx.root.join("pull")).unwrap();
    let paths: Vec<String> = (0..500).map(|i| format!("pull/f{i}.excalidraw")).collect();
    for p in &paths {
        fs::write(fx.root.join(p), scene(9, 5, 0, 0).json()).unwrap();
    }
    let t0 = Instant::now();
    fx.svc.watched("h", &paths, &[], false);
    fx.barrier();
    let ms = t0.elapsed().as_millis();
    assert!(fx.vh().read_index().lineages.is_empty(), "no clones, no versions");
    assert!(ms < 2000, "worker time for 500 paths: {ms} ms");
    // One of them has a pending clone and changes: exactly that one is versioned.
    let j0 = scene(10, 40, 0, 0).json();
    save_exp(&fx, "pull/f7.excalidraw", &j0, Some(&disk_rev(&fx, "pull/f7.excalidraw")));
    fs::write(fx.root.join("pull/f7.excalidraw"), scene(11, 12, 0, 0).json()).unwrap();
    fx.svc.watched("h", &paths, &[], false);
    fx.barrier();
    assert_eq!(fx.vh().read_index().lineages.len(), 1);
    let vs = fx.versions("pull/f7.excalidraw");
    assert_eq!(vs.len(), 1);
    assert_eq!(exact(&fx, &vs[0].id), j0.as_bytes());
}

#[test]
fn non_drawing_paths_are_not_even_queued() {
    let fx = Fx::new();
    fx.start_configured(5);
    outside::watched(&fx.vh(), &["notes.txt".into(), "img/a.png".into(), "x.excalidraw.bak".into()]);
    // Nothing queued: the next urgent message is ours.
    fx.barrier();
    assert!(fx.vh().read_index().lineages.is_empty());
}

#[test]
fn snapshot_bytes_rejects_bad_requests() {
    let fx = Fx::new();
    fx.start_configured(5);
    let vh = fx.vh();
    let body = scene(1, 5, 0, 0).json();
    let rev = crate::revision(body.as_bytes());
    let code = |r: Result<SnapshotOutcome>| r.unwrap_err().code;
    assert_eq!(code(outside::snapshot_bytes(&vh, P, "leave", &rev, body.as_bytes())), "INVALID_ARGUMENT");
    assert_eq!(code(outside::snapshot_bytes(&vh, P, "whatever", &rev, body.as_bytes())), "INVALID_ARGUMENT");
    assert_eq!(code(outside::snapshot_bytes(&vh, P, "discarded-edits", &"a".repeat(64), body.as_bytes())), "REVISION_MISMATCH");
    assert_eq!(code(outside::snapshot_bytes(&vh, P, "discarded-edits", &rev.to_uppercase(), body.as_bytes())), "REVISION_MISMATCH");
    assert_eq!(code(outside::snapshot_bytes(&vh, P, "discarded-edits", &rev[..40], body.as_bytes())), "REVISION_MISMATCH");
    assert_eq!(code(outside::snapshot_bytes(&vh, P, "discarded-edits", "", body.as_bytes())), "REVISION_MISMATCH");
    assert!(fx.versions(P).is_empty());
    assert!(all_staged(&fx).is_empty(), "no scratch file is left behind: {:?}", all_staged(&fx));
}

#[test]
fn snapshot_bytes_is_skipped_in_a_read_only_window() {
    let fx = Fx::new();
    fx.start(true);
    let body = scene(1, 5, 0, 0).json();
    let out = snap(&fx, P, "discarded-edits", &body).unwrap();
    assert_eq!((out.id, out.skipped.as_deref()), (None, Some("read-only")));
}

#[test]
fn before_outside_change_snapshot_needs_the_unversioned_commit_as_pending() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    let j0 = scene(1, 30, 0, 0).json();
    // Not pending at all.
    assert_eq!(snap(&fx, P, BEFORE, &j0).unwrap().skipped.as_deref(), Some("not-pending"));
    fx.save(P, &j0);
    // Pending, but another revision.
    let other = scene(2, 30, 0, 0).json();
    assert_eq!(snap(&fx, P, BEFORE, &other).unwrap().skipped.as_deref(), Some("not-pending"));
    assert!(fx.versions(P).is_empty());
    // The pending commit itself: accepted, written byte-exact, no longer pending.
    let out = snap(&fx, P, BEFORE, &j0).unwrap();
    assert!(out.id.is_some() && out.skipped.is_none(), "{out:?}");
    let vs = fx.versions(P);
    assert_eq!(vs.len(), 1);
    assert_eq!(vs[0].reason, BEFORE);
    assert_eq!(exact(&fx, &vs[0].id), j0.as_bytes());
    assert!(fx.staged_files().is_empty(), "pending dropped with its clone");
    assert_eq!(snap(&fx, P, BEFORE, &j0).unwrap().skipped.as_deref(), Some("not-pending"));
    assert!(all_staged(&fx).is_empty(), "scratch files are always deleted: {:?}", all_staged(&fx));
}

#[test]
fn before_outside_change_snapshot_works_without_clones_non_apfs_case() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.vh().flags.staging_unsupported.store(true, std::sync::atomic::Ordering::Relaxed);
    fx.open(None);
    let j0 = scene(1, 30, 0, 0).json();
    fx.save(P, &j0);
    assert!(fx.staged_files().is_empty(), "no clone on this volume");
    // The live file was changed from outside; the frontend still has the bytes it saved.
    fs::write(fx.root.join(P), scene(2, 8, 0, 0).json()).unwrap();
    watch(&fx, &[P]);
    assert!(fx.versions(P).is_empty(), "nothing staged: the watcher can't do it");
    let out = snap(&fx, P, BEFORE, &j0).unwrap();
    assert!(out.id.is_some(), "{out:?}");
    assert_eq!(exact(&fx, &fx.versions(P)[0].id), j0.as_bytes());
}

#[test]
fn discarded_edits_are_always_versioned_unless_they_equal_the_newest_version() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (_, newest) = make_history(&fx, A, 1);
    let edits = scene(33, 25, 1, 3000).json();
    let out = snap(&fx, A, "discarded-edits", &edits).unwrap();
    assert!(out.id.is_some(), "{out:?}");
    let vs = fx.versions(A);
    assert_eq!(vs.len(), 3);
    assert_eq!(vs[0].reason, "discarded-edits");
    assert_eq!(exact(&fx, &vs[0].id), edits.as_bytes(), "byte-exact, image included");
    assert_eq!(snap(&fx, A, "discarded-edits", &edits).unwrap().skipped.as_deref(), Some("unchanged"));
    assert_eq!(fx.versions(A).len(), 3);
    // Equal to the state versioned before: it is not the newest anymore, so it is kept again.
    assert!(snap(&fx, A, "discarded-edits", &newest).unwrap().id.is_some());
    assert_eq!(fx.versions(A).len(), 4);
    // A drawing without any history gets its first lineage from it.
    assert!(snap(&fx, "new.excalidraw", "discarded-edits", &edits).unwrap().id.is_some());
    assert_eq!(fx.versions("new.excalidraw").len(), 1);
    assert!(all_staged(&fx).is_empty());
}

#[test]
fn before_rewrite_versions_only_when_the_state_is_not_already_the_newest_version() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (_, _) = make_history(&fx, A, 1);
    // 1. The file equals the newest version: nothing to keep.
    fx.svc.before_link_rewrite("h", A);
    fs::write(fx.root.join(A), scene(50, 20, 0, 0).json()).unwrap(); // the rewrite
    fx.barrier();
    assert_eq!(fx.versions(A).len(), 2);
    assert!(all_staged(&fx).is_empty(), "rewrite clone is deleted: {:?}", all_staged(&fx));
    // 2. The live file differs from the newest version (changed outside, never versioned).
    let outside_json = scene(51, 20, 0, 0).json();
    fs::write(fx.root.join(A), &outside_json).unwrap();
    fx.svc.before_link_rewrite("h", A);
    fs::write(fx.root.join(A), scene(52, 20, 0, 0).json()).unwrap();
    fx.barrier();
    let vs = fx.versions(A);
    assert_eq!(vs.len(), 3);
    assert_eq!(vs[0].reason, BEFORE);
    assert_eq!(exact(&fx, &vs[0].id), outside_json.as_bytes());
    // 3. A pending state is the pre-rewrite state (the commit is still unversioned).
    fx.open(Some(A));
    let mut sc = scene(53, 20, 0, 0);
    sc.edit();
    let pending_json = sc.json();
    save_exp(&fx, A, &pending_json, Some(&disk_rev(&fx, A)));
    fx.svc.before_link_rewrite("h", A);
    fs::write(fx.root.join(A), scene(54, 20, 0, 0).json()).unwrap();
    fx.barrier();
    let vs = fx.versions(A);
    assert_eq!(vs.len(), 4);
    assert_eq!(vs[0].reason, BEFORE);
    assert_eq!(exact(&fx, &vs[0].id), pending_json.as_bytes());
    assert!(fx.staged_files().is_empty());
    // 4. A drawing with no history and nothing pending is left alone.
    let lineages = fx.vh().read_index().lineages.len();
    fs::write(fx.root.join("q.excalidraw"), scene(55, 5, 0, 0).json()).unwrap();
    fx.svc.before_link_rewrite("h", "q.excalidraw");
    fx.barrier();
    assert_eq!(fx.vh().read_index().lineages.len(), lineages);
    assert!(all_staged(&fx).is_empty());
}

#[test]
fn startup_removes_scratch_files_but_keeps_pending_survivors() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    let j0 = scene(1, 30, 0, 0).json();
    fx.save(P, &j0);
    fx.barrier();
    let dir = fx.vh().staged_dir.clone();
    fx.svc.stop("h");
    for n in ["xs-1-1-1.tmp", "xr-2-2-2.tmp"] {
        fs::write(dir.join(n), b"x").unwrap();
    }
    fs::write(dir.join("unrelated.tmp"), b"x").unwrap();
    fx.start_configured(5);
    wait_for("survivor versioned", || fx.versions(P).len() == 1);
    wait_for("scratch removed", || !dir.join("xs-1-1-1.tmp").exists() && !dir.join("xr-2-2-2.tmp").exists());
    assert!(dir.join("unrelated.tmp").exists(), "only our own scratch names are touched");
    assert_eq!(fx.versions(P)[0].reason, Reason::Recovered.as_str());
    assert_eq!(exact(&fx, &fx.versions(P)[0].id), j0.as_bytes());
}

#[test]
fn urgent_messages_are_served_before_background_chunks() {
    let ib = Inbox::default();
    ib.send_task(Task::Reconcile);
    ib.send_task(Task::Reconcile);
    ib.send(Msg::Watched(Vec::new()));
    assert!(matches!(ib.pop(None, true), Popped::Msg(Msg::Watched(_))), "urgent first, even with background work queued");
    assert!(matches!(ib.pop(None, true), Popped::Task(Task::Reconcile)));
    assert!(matches!(ib.pop(None, true), Popped::Task(Task::Reconcile)));
    assert!(matches!(ib.pop(None, true), Popped::Timeout), "poll_only never blocks");
}

#[test]
fn checkpoints_complete_promptly_while_the_open_time_background_passes_run() {
    use crate::history::core_tests::support::mk_writer;
    // Many lineages make the open-time passes (reconcile, orphan check, sweep) long enough to overlap.
    let fx = Fx::new();
    {
        let mut w = mk_writer(&fx.root, &fx.state, fx.clock.clone(), Box::new(|| true));
        for i in 0..400 {
            let p = format!("m{i}.excalidraw");
            version_of_json(&mut w, &fx.root, &p, &scene(i, 4, 0, 0).json());
        }
    }
    fx.start_configured(5);
    let (lin, _) = make_history(&fx, A, 1);
    let _ = lin;
    let mut ms: Vec<f64> = Vec::new();
    for i in 0..15 {
        let t = Instant::now();
        let out = fx.vh().checkpoint(A, &format!("cp{i}"), "").unwrap();
        ms.push(t.elapsed().as_secs_f64() * 1e3);
        assert_eq!(out.reason, "checkpoint");
    }
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    eprintln!("checkpoint wait during background passes: p50 {:.1} ms, max {:.1} ms", ms[ms.len() / 2], ms[ms.len() - 1]);
    assert!(ms[ms.len() - 1] < 1000.0, "urgent messages must not wait for background passes");
}

fn version_of_json(w: &mut crate::history::writer::Writer, root: &std::path::Path, p: &str, json: &str) {
    super::support::version_of(w, root, p, json, Reason::Auto).unwrap();
}

#[test]
fn control_rename_helper_resolves() {
    // Guards the helper the negative relink tests rely on.
    let fx = Fx::new();
    fx.start_configured(5);
    control_rename(&fx);
    watch(&fx, &["z.excalidraw", "z2.excalidraw"]);
    wait_control(&fx);
}

// ---------------------------------------------------------------------------------------------
// Benches
// ---------------------------------------------------------------------------------------------

fn profile() -> String {
    std::env::var("HISTORY_PERF_PROFILE").unwrap_or_else(|_| "normal".into())
}

fn pct(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() as f64 - 1.0) * p).round() as usize]
}

fn emit(metric: &str, unit: &str, mut s: Vec<f64>, extra: &str) {
    let (p50, p95, max, n) = (pct(&mut s, 0.5), pct(&mut s, 0.95), pct(&mut s, 1.0), s.len());
    println!("HISTORY_PERF {{\"metric\":\"history.{metric}\",\"unit\":\"{unit}\",\"p50\":{p50:.3},\"p95\":{p95:.3},\"max\":{max:.3},\"n\":{n},\"profile\":\"{}\"{extra}}}", profile());
}

/// Per echo path: watcher side (filter + queue) plus the worker's identity check (stat + compare
/// with the staged clone), for drawings that all have a pending clone. Includes the barrier
/// round trip once per batch (amortised over the batch).
#[test]
#[ignore]
fn bench_outside_detect() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    let n = 200usize;
    let paths: Vec<String> = (0..n).map(|i| format!("e{i}.excalidraw")).collect();
    for (i, p) in paths.iter().enumerate() {
        fx.save(p, &scene(i as u64, 30, 0, 0).json());
    }
    fx.barrier();
    let (mut total, mut watcher) = (Vec::new(), Vec::new());
    for _ in 0..40 {
        let t0 = Instant::now();
        fx.svc.watched("h", &paths, &[], false);
        let w = t0.elapsed();
        fx.barrier();
        let all = t0.elapsed();
        total.push(all.as_secs_f64() * 1e6 / n as f64);
        watcher.push(w.as_secs_f64() * 1e6 / n as f64);
    }
    assert!(fx.vh().read_index().lineages.is_empty(), "echoes made no versions");
    let wp95 = pct(&mut watcher, 0.95);
    emit("outside.detect", "us", total, &format!(",\"watcher_p95_us\":{wp95:.3},\"paths\":{n}"));
}

/// A `git pull` of 500 changed drawings without clones: worker time from queue to done.
#[test]
#[ignore]
fn bench_outside_pull500() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    fs::create_dir(fx.root.join("pull")).unwrap();
    let paths: Vec<String> = (0..500).map(|i| format!("pull/f{i}.excalidraw")).collect();
    for p in &paths {
        fs::write(fx.root.join(p), scene(1, 20, 0, 0).json()).unwrap();
    }
    let mut ms = Vec::new();
    for _ in 0..20 {
        let t0 = Instant::now();
        fx.svc.watched("h", &paths, &[], false);
        fx.barrier();
        ms.push(t0.elapsed().as_secs_f64() * 1e3);
    }
    assert!(fx.vh().read_index().lineages.is_empty());
    emit("outside.pull500", "ms", ms, ",\"paths\":500");
}
