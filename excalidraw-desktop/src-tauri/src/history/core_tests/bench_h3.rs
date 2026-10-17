//! H3 benches (`#[ignore]`): one `HISTORY_PERF {...}` line per metric, same format and profile
//! convention as `bench.rs` (low-end: `taskpolicy -c background env HISTORY_PERF_PROFILE=low-end`).
//!
//! normal:   cargo test --release --offline history::core_tests::bench_h3 -- --ignored --nocapture --test-threads=1
//! low-end:  taskpolicy -c background env HISTORY_PERF_PROFILE=low-end <same command>
//!
//! Budgets (PLAN-H3 section 5), asserted here: retention.lineage p95 <= 50 us (500 versions),
//! retention.vault10k <= 20 ms with every chunk <= 5 ms, snapshot.wait.urgent during a sweep p95
//! <= 100 ms (400 ms low-end), disk.steady.5kimg <= 60 MB and <= 120 files per lineage after 60
//! simulated days. CPU-bound budgets get a 4x allowance in the low-end profile.
use super::support::*;
use crate::history::{
    gc::{self, Ctx, Sweep},
    index::{Entry, Head},
    names::{self, NameKind, Reason, UlidGen, VersionName},
    retention::{self, Env, Kind, Policy, DAY_MS, HOUR_MS, V},
    writer::{Clock, Epoch, Outcome, Writer},
    HistorySettings,
};
use std::{
    fs,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

fn profile() -> String {
    std::env::var("HISTORY_PERF_PROFILE").unwrap_or_else(|_| "normal".into())
}
/// Allowance for CPU-bound budgets under `taskpolicy -c background`.
fn allowance() -> f64 {
    if profile() == "low-end" {
        4.0
    } else {
        1.0
    }
}

fn pct(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() as f64 - 1.0) * p).round() as usize]
}

fn emit(metric: &str, unit: &str, mut s: Vec<f64>, extra: &str) -> (f64, f64, f64) {
    let (p50, p95, max, n) = (pct(&mut s, 0.5), pct(&mut s, 0.95), pct(&mut s, 1.0), s.len());
    println!("HISTORY_PERF {{\"metric\":\"history.{metric}\",\"unit\":\"{unit}\",\"p50\":{p50:.3},\"p95\":{p95:.3},\"max\":{max:.3},\"n\":{n},\"profile\":\"{}\"{extra}}}", profile());
    (p50, p95, max)
}

const ME: &str = "meeeeeee";
const OTHER: &str = "b2c3d4e5";

// ---------------------------------------------------------------------------------------------
// Synthetic lineages (pure planner)
// ---------------------------------------------------------------------------------------------

struct O {
    id: String,
    dev: &'static str,
    t: u64,
    key: Option<String>,
    reason: Reason,
}

/// `n` versions over `days` days: a keyframe every 50 versions, 1 in 40 a checkpoint, a fifth of
/// them written by another device (with its own keyframes).
fn synth(n: usize, days: u64, seed: u64, now: u64) -> Vec<O> {
    let mut r = Rng(seed | 1);
    let mut ts: Vec<u64> = (0..n).map(|_| now - r.next() % (days * DAY_MS)).collect();
    ts.sort_unstable();
    let mut out: Vec<O> = Vec::with_capacity(n);
    let mut key: [Option<String>; 2] = [None, None];
    let mut since = [0usize; 2];
    for (i, t) in ts.into_iter().enumerate() {
        let d = usize::from(r.below(5) == 0);
        let dev = if d == 0 { ME } else { OTHER };
        let id = format!("{t:016}{:04}", i % 10_000);
        if key[d].is_none() || since[d] >= 50 {
            key[d] = Some(id.clone());
            since[d] = 0;
            out.push(O { id, dev, t, key: None, reason: Reason::Auto });
        } else {
            since[d] += 1;
            let reason = if r.below(40) == 0 { Reason::Checkpoint } else { Reason::Auto };
            out.push(O { id, dev, t, key: key[d].clone(), reason });
        }
    }
    out
}

fn views(os: &[O]) -> Vec<V<'_>> {
    os.iter().map(|o| V { id: &o.id, dev: o.dev, t: o.t, kind: o.key.as_deref().map_or(Kind::Keyframe, Kind::Delta), reason: o.reason, size: 1000, path: None }).collect()
}

#[test]
#[ignore]
fn bench_h3_retention_lineage() {
    let now = T0;
    let pol = Policy::from_settings(&HistorySettings::default());
    let ls = |d: &str| (d == OTHER).then_some(now - DAY_MS);
    let nw = |_: &str| 0u64;
    let env = Env { now, me: ME, offset_secs: &retention::local_offset_secs, last_seen: &ls, newest_of: &nw };
    let os = synth(500, 14, 7, now);
    let v = views(&os);
    for _ in 0..300 {
        std::hint::black_box(retention::plan(&v, &pol, &env));
    }
    let mut samples = Vec::new();
    let mut dels = 0;
    for _ in 0..4000 {
        let t0 = Instant::now();
        let r = retention::plan(&v, &pol, &env);
        samples.push(t0.elapsed().as_nanos() as f64 / 1000.0);
        dels = r.len();
        std::hint::black_box(r);
    }
    assert!(dels > 100, "a realistic lineage has plenty to thin ({dels})");
    let (_, p95, _) = emit("retention.lineage", "us", samples, &format!(",\"versions\":500,\"deletes\":{dels},\"budget_p95_us\":{},\"src\":\"h3\"", 50.0 * allowance()));
    assert!(p95 <= 50.0 * allowance(), "retention.lineage p95 {p95:.1} us > 50 us budget");
}

#[test]
#[ignore]
fn bench_h3_retention_vault10k() {
    let now = T0;
    let pol = Policy::from_settings(&HistorySettings::default());
    let ls = |d: &str| (d == OTHER).then_some(now - 40 * DAY_MS);
    let nw = |_: &str| now - 10 * DAY_MS;
    let env = Env { now, me: ME, offset_secs: &retention::local_offset_secs, last_seen: &ls, newest_of: &nw };
    // 10k versions in 40 lineages of 250, 60 days: every lineage plan + the vault-wide cap plan
    let lins: Vec<Vec<O>> = (0..40).map(|i| synth(250, 60, 100 + i, now)).collect();
    let vs: Vec<Vec<V>> = lins.iter().map(|l| views(l)).collect();
    let (mut totals, mut chunks) = (Vec::new(), Vec::new());
    let mut dels = 0;
    for round in 0..25 {
        let t_all = Instant::now();
        let mut worst = 0f64;
        dels = 0;
        for l in &vs {
            let t0 = Instant::now();
            dels += retention::plan(l, &pol, &env).len();
            worst = worst.max(t0.elapsed().as_secs_f64() * 1000.0);
        }
        let t0 = Instant::now();
        let sl: Vec<&[V]> = vs.iter().map(Vec::as_slice).collect();
        let (c, _) = retention::plan_cap(&sl, 5_000_000, ME);
        worst = worst.max(t0.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(c.len());
        if round >= 3 {
            totals.push(t_all.elapsed().as_secs_f64() * 1000.0);
            chunks.push(worst);
        }
    }
    let max_chunk = pct(&mut chunks, 1.0);
    let (_, _, max) = emit("retention.vault10k", "ms", totals, &format!(",\"versions\":10000,\"deletes\":{dels},\"max_chunk_ms\":{max_chunk:.3},\"budget_total_ms\":{},\"budget_chunk_ms\":5,\"src\":\"h3\"", 20.0 * allowance()));
    assert!(max <= 20.0 * allowance(), "retention.vault10k {max:.2} ms > 20 ms budget");
    assert!(max_chunk <= 5.0 * allowance(), "retention.vault10k chunk {max_chunk:.2} ms > 5 ms budget");
}

// ---------------------------------------------------------------------------------------------
// The real sweep over a 10k-version index
// ---------------------------------------------------------------------------------------------

/// A read-only service with a `Writer` on the test thread (the device id is the service's).
struct Sim {
    fx: Fx,
    vh: Arc<crate::history::VaultHistory>,
    me: String,
    w: Writer,
    clock: Arc<TestClock>,
    settings: HistorySettings,
}

fn sim() -> Sim {
    let fx = Fx::new();
    fx.start(true);
    let vh = fx.vh();
    vh.ensure_loaded();
    fs::create_dir_all(&vh.state_hist).unwrap();
    let me = names::load_or_create_device(&vh.state_hist).unwrap();
    let clock = TestClock::new(T0);
    let w = Writer::new(vh.store.clone(), vh.index.clone(), me.clone(), UlidGen::load(None), Epoch::load(None, T0), clock.clone(), Box::new(|| true), Box::new(|| true));
    Sim { fx, vh, me, w, clock, settings: HistorySettings::default() }
}

impl Sim {
    fn ctx(&self, now: u64) -> Ctx<'_> {
        Ctx { vh: &self.vh, dev: &self.me, now_ms: now, settings: &self.settings }
    }
    fn put(&mut self, path: &str, json: &str, t: u64) -> String {
        self.clock.0.store(t, Ordering::SeqCst);
        match version_of(&mut self.w, &self.fx.root, path, json, Reason::Auto).unwrap() {
            Outcome::Written(x) => x.lineage,
            o => panic!("not written: {o:?}"),
        }
    }
}

/// 10k index entries in 40 lineages (no files: unlinks of missing files are cheap no-ops that
/// still update the index, so this measures planning, locking and bookkeeping per sweep unit).
fn fill_index(s: &Sim, lineages: usize, per: usize, days: u64) {
    let mut r = Rng(9);
    let mut g = s.vh.index.write().unwrap();
    for l in 0..lineages {
        let lin = UlidGen::load(None).next(T0 - days * DAY_MS + l as u64);
        let mut ts: Vec<u64> = (0..per).map(|_| T0 - r.next() % (days * DAY_MS)).collect();
        ts.sort_unstable();
        let mut gen = UlidGen::load(None);
        let mut key: Option<String> = None;
        let mut count = 0;
        for (i, t) in ts.into_iter().enumerate() {
            let id = gen.next(t);
            let dev = if r.below(5) == 0 { OTHER } else { s.me.as_str() };
            let kind = match &key {
                Some(k) if count < 50 => {
                    count += 1;
                    NameKind::Delta(if r.below(40) == 0 { Reason::Checkpoint } else { Reason::Auto }, k.clone())
                }
                _ => {
                    key = Some(id.clone());
                    count = 0;
                    NameKind::Keyframe(Reason::Auto)
                }
            };
            let head = Head { path: format!("d{l}.excalidraw"), name: None, note: None, rev: format!("r{l}-{i}"), element_count: 100, blobs: Vec::new() };
            g.insert(&lin, Entry { name: VersionName { id, dev: dev.to_string(), kind }, size: 2000, dataless: false, head: Some(head) }, T0);
        }
    }
}

#[test]
#[ignore]
fn bench_h3_sweep_units_over_10k_versions() {
    let s = sim();
    fill_index(&s, 40, 250, 60);
    assert_eq!(s.vh.read_index().version_count(), 10_000);
    let ctx = s.ctx(T0);
    let mut sweep = Sweep::new(&ctx);
    let mut chunks = Vec::new();
    let t_all = Instant::now();
    loop {
        let t0 = Instant::now();
        let done = sweep.step_with(&ctx, Duration::ZERO, &|_| 0);
        chunks.push(t0.elapsed().as_secs_f64() * 1000.0);
        if done {
            break;
        }
    }
    let total = t_all.elapsed().as_secs_f64() * 1000.0;
    let left = s.vh.read_index().version_count();
    assert!(left < 2000, "the sweep thinned the vault ({left} left)");
    let n = chunks.len();
    let max = pct(&mut chunks.clone(), 1.0);
    emit("sweep.10k.unit", "ms", chunks, &format!(",\"versions\":10000,\"left\":{left},\"units\":{n},\"total_ms\":{total:.1},\"budget_chunk_ms\":5,\"src\":\"h3\""));
    assert!(max <= 5.0 * allowance(), "a sweep unit took {max:.2} ms (> 5 ms chunk budget)");
}

// ---------------------------------------------------------------------------------------------
// Urgent snapshot wait during a sweep (real worker)
// ---------------------------------------------------------------------------------------------

const P: &str = "a.excalidraw";

#[test]
#[ignore]
fn bench_h3_snapshot_wait_urgent_during_a_sweep() {
    let (mut waits, mut overlap) = (Vec::new(), 0);
    let rounds = 10;
    for round in 0..rounds {
        // a vault with plenty to thin: 20 drawings x 40 versions 30 min apart, 45 days ago
        let mut s = sim();
        let now = s.fx.clock.now_ms();
        for d in 0..20u64 {
            let mut sc = scene(round * 100 + d, 60, 0, 0);
            for i in 0..40u64 {
                sc.edit();
                s.put(&format!("d{d}.excalidraw"), &sc.json(), now - 45 * DAY_MS + i * 30 * 60_000);
            }
        }
        s.fx.svc.stop("h");
        let fx = &s.fx;
        let before = 800;
        fx.start_configured(5);
        let vh = fx.vh();
        let mut sc = scene(3, 200, 0, 0);
        fx.save(P, &sc.json());
        fx.open(Some(P));
        for k in 0..3 {
            sc.edit();
            fx.save(P, &sc.json());
            let t = Instant::now();
            let o = vh.snapshot(P, "before-restore", true).unwrap();
            waits.push(t.elapsed().as_secs_f64() * 1e3);
            assert!(o.id.is_some() || o.skipped.is_some());
            if k == 0 {
                overlap += usize::from(vh.read_index().version_count() > before / 4);
            }
        }
        wait_for("sweep thinned the vault", || vh.read_index().version_count() < before / 2);
    }
    let (_, p95, _) = emit("snapshot.wait.urgent", "ms", waits, &format!(",\"during\":\"sweep\",\"rounds\":{rounds},\"sweep_overlapped_rounds\":{overlap},\"budget_p95_ms\":{},\"src\":\"h3\"", if profile() == "low-end" { 400 } else { 100 }));
    assert!(overlap > 0, "the sweep must have been running during the measurement");
    assert!(p95 <= if profile() == "low-end" { 400.0 } else { 100.0 }, "snapshot.wait.urgent p95 {p95:.1} ms");
}

// ---------------------------------------------------------------------------------------------
// Steady-state disk use
// ---------------------------------------------------------------------------------------------

fn dir_bytes(d: &std::path::Path) -> (u64, usize) {
    let Ok(rd) = fs::read_dir(d) else { return (0, 0) };
    rd.flatten().map(|e| if e.path().is_dir() { dir_bytes(&e.path()) } else { (e.metadata().map_or(0, |m| m.len()), 1) }).fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1))
}

#[test]
#[ignore]
fn bench_h3_disk_steady_state_5k_elements_with_images_over_60_days() {
    let mut s = sim();
    // 5k elements + 6 images of 300 KB (the 5kimg scene of the H1 benches); 2 h of editing a
    // day with the default 5 min interval, daily sweeps as the worker runs them, retention after
    // every written version.
    let mut sc = scene(1, 5000, 6, 300_000);
    let mut lin = String::new();
    let mut writes = 0;
    let mut peak_files = 0;
    let t0 = Instant::now();
    for day in 0..60u64 {
        let base = T0 + day * DAY_MS + 9 * HOUR_MS;
        for i in 0..24u64 {
            sc.edit();
            let t = base + i * 5 * 60_000;
            lin = s.put(P, &sc.json(), t);
            writes += 1;
            gc::after_write(&s.ctx(t), &lin);
        }
        let end = base + 23 * HOUR_MS;
        let ctx = s.ctx(end);
        let mut sweep = Sweep::new(&ctx);
        while !sweep.step_with(&ctx, Duration::from_secs(5), &|_| 0) {}
        let lin_dir = s.fx.hist_dir().join(&lin);
        peak_files = peak_files.max(dir_bytes(&lin_dir).1);
    }
    let hist = s.fx.hist_dir();
    let (bytes, files) = dir_bytes(&hist);
    let lin_files = dir_bytes(&hist.join(&lin)).1;
    let blob_files = dir_bytes(&hist.join("blobs")).1;
    let mb = bytes as f64 / 1048576.0;
    println!("simulated 60 days: {writes} versions written in {:.1} s", t0.elapsed().as_secs_f64());
    emit("disk.steady.5kimg", "MB", vec![mb], &format!(",\"files\":{files},\"lineage_files\":{lin_files},\"peak_lineage_files\":{peak_files},\"blob_files\":{blob_files},\"writes\":{writes},\"budget_mb\":60,\"src\":\"h3\""));
    emit("disk.steady.5kimg.files", "files", vec![lin_files as f64], &format!(",\"peak\":{peak_files},\"budget\":120,\"src\":\"h3\""));
    assert!(mb <= 60.0, "disk {mb:.1} MB > 60 MB");
    assert!(lin_files <= 120 && peak_files <= 120, "{lin_files} files in the lineage (peak {peak_files}) > 120");
    assert_eq!(verify_all_versions(&s.fx.root), s.vh.read_index().version_count());
}
