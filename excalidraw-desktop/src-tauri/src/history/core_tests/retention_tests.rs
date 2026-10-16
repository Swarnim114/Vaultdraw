//! Retention planner tables (pure; PLAN-H3 4.1 to 4.3) and its micro-benches.
use crate::history::{
    names::Reason,
    retention::{self, Delete, Env, Kind, Policy, V, DAY_MS, HOUR_MS, WEEK_MS},
    HistorySettings,
};
use std::collections::HashMap;

/// 2027-01-15 08:00:00 UTC: hour aligned (and a Friday).
const NOW: u64 = 1_800_000_000_000;
/// Midnight UTC of a Monday, 2027-01-11.
const MON: u64 = 20829 * DAY_MS;
const ME: &str = "meeeeeee";
const OTHER: &str = "b2c3d4e5";

#[derive(Clone)]
struct O {
    id: String,
    dev: &'static str,
    t: u64,
    kind: Option<String>, // None = keyframe, Some(key id) = delta, Some("") never
    path_rec: bool,
    reason: Reason,
    size: u64,
    path: Option<&'static str>,
}

fn id_at(t: u64, n: usize) -> String {
    format!("{t:016}{n:04}")
}

fn kf(t: u64) -> O {
    O { id: id_at(t, 0), dev: ME, t, kind: None, path_rec: false, reason: Reason::Auto, size: 1000, path: None }
}
fn delta_on(t: u64, key: &O) -> O {
    O { id: id_at(t, 1), kind: Some(key.id.clone()), ..kf(t) }
}
fn pm(t: u64, path: Option<&'static str>) -> O {
    O { id: id_at(t, 2), path_rec: true, reason: Reason::Moved, path, size: 100, ..kf(t) }
}
fn reason(mut o: O, r: Reason) -> O {
    o.reason = r;
    o
}
fn dev(mut o: O, d: &'static str) -> O {
    o.dev = d;
    o
}

fn views(os: &mut Vec<O>) -> Vec<V<'_>> {
    os.sort_by(|a, b| a.id.cmp(&b.id));
    os.iter()
        .map(|o| V {
            id: &o.id,
            dev: o.dev,
            t: o.t,
            kind: if o.path_rec { Kind::Path } else { o.kind.as_deref().map_or(Kind::Keyframe, Kind::Delta) },
            reason: o.reason,
            size: o.size,
            path: o.path,
        })
        .collect()
}

struct World {
    now: u64,
    off: Box<dyn Fn(u64) -> i32>,
    seen: HashMap<String, u64>,
    newest: HashMap<String, u64>,
}

impl World {
    fn new(now: u64) -> World {
        World { now, off: Box::new(|_| 0), seen: HashMap::new(), newest: HashMap::new() }
    }
    fn unseen(mut self, dev: &str, days: u64) -> World {
        self.seen.insert(dev.to_string(), self.now - days * DAY_MS);
        self
    }
    fn newest(mut self, dev: &str, t: u64) -> World {
        self.newest.insert(dev.to_string(), t);
        self
    }
    fn offset(mut self, f: impl Fn(u64) -> i32 + 'static) -> World {
        self.off = Box::new(f);
        self
    }
    fn plan(&self, os: &mut Vec<O>, p: &Policy) -> Vec<Delete> {
        let v = views(os);
        let ls = |d: &str| self.seen.get(d).copied();
        let nw = |d: &str| self.newest.get(d).copied().unwrap_or(0);
        let env = Env { now: self.now, me: ME, offset_secs: &*self.off, last_seen: &ls, newest_of: &nw };
        retention::plan(&v, p, &env)
    }
    /// Ids deleted, in plan order.
    fn deleted(&self, os: &mut Vec<O>, p: &Policy) -> Vec<String> {
        let plan = self.plan(os, p);
        let v: Vec<String> = os.iter().map(|o| o.id.clone()).collect();
        plan.iter().map(|d| v[d.idx].clone()).collect()
    }
}

fn policy() -> Policy {
    Policy::from_settings(&HistorySettings::default())
}
fn ids(os: &[&O]) -> Vec<String> {
    os.iter().map(|o| o.id.clone()).collect()
}
fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

#[test]
fn policy_windows_never_shrink_and_weekly_zero_is_forever() {
    let p = Policy::from_settings(&HistorySettings { keep_all_hours: 5, keep_hourly_hours: 2, keep_daily_days: 0, keep_weekly_weeks: 0, size_cap_mb: 0, ..Default::default() });
    assert_eq!((p.keep_all_ms, p.hourly_end_ms, p.daily_end_ms, p.weekly_end_ms, p.cap_bytes), (5 * HOUR_MS, 5 * HOUR_MS, 5 * HOUR_MS, None, 0));
    let p = Policy::from_settings(&HistorySettings { keep_weekly_weeks: 3, ..Default::default() });
    assert_eq!(p.weekly_end_ms, Some(30 * DAY_MS + 3 * WEEK_MS));
    assert_eq!(policy().cap_bytes, 500 * 1024 * 1024);
}

#[test]
fn empty_and_single_versions() {
    let w = World::new(NOW);
    assert!(w.deleted(&mut vec![], &policy()).is_empty());
    let mut one = vec![kf(NOW - 800 * DAY_MS)];
    assert!(w.deleted(&mut one, &policy()).is_empty(), "the newest version is always kept, however old");
}

#[test]
fn keep_all_window_and_its_boundary() {
    let w = World::new(NOW);
    // Three versions inside the hour stay; one at exactly 1 h is still "all", one 1 ms later is hourly.
    let a = kf(NOW - 10 * 60_000);
    let b = kf(NOW - 20 * 60_000);
    let c = kf(NOW - HOUR_MS);
    let d = kf(NOW - HOUR_MS - 1);
    let mut os = vec![a.clone(), b.clone(), c.clone(), d.clone()];
    assert!(w.deleted(&mut os, &policy()).is_empty(), "c is all-tier, d is the only one of its hour bucket... ");
    // d shares its local hour with e (older, same hour): only the newer one stays.
    let e = O { id: id_at(NOW - HOUR_MS - 60_000, 7), ..kf(NOW - HOUR_MS - 60_000) };
    let mut os = vec![a, b, c, d.clone(), e.clone()];
    assert_eq!(w.deleted(&mut os, &policy()), ids(&[&e]));
}

#[test]
fn hourly_newest_per_local_hour() {
    let w = World::new(NOW);
    let keep1 = kf(NOW - 2 * HOUR_MS - 10 * 60_000);
    let gone1 = kf(NOW - 2 * HOUR_MS - 30 * 60_000);
    let gone2 = kf(NOW - 2 * HOUR_MS - 50 * 60_000);
    let keep2 = kf(NOW - 3 * HOUR_MS - 10 * 60_000);
    let newest = kf(NOW - 5 * 60_000);
    let mut os = vec![gone2.clone(), keep1, gone1.clone(), keep2, newest];
    assert_eq!(sorted(w.deleted(&mut os, &policy())), sorted(ids(&[&gone1, &gone2])));
}

#[test]
fn daily_tier_uses_local_midnight_and_offsets() {
    // 23:00 UTC and 00:30 UTC next day, 5 days back. UTC: two days. At UTC+1 (local 00:00 and 01:30): one day.
    let day0 = NOW - NOW % DAY_MS - 5 * DAY_MS; // midnight UTC five days ago
    let late = kf(day0 + 23 * HOUR_MS);
    let early = kf(day0 + 24 * HOUR_MS + 30 * 60_000);
    // Both are daily-tier (older than 24 h). Give the lineage a newer version so neither is "newest".
    let newest = kf(NOW);
    let utc = World::new(NOW);
    let mut os = vec![late.clone(), early.clone(), newest.clone()];
    assert!(utc.deleted(&mut os, &policy()).is_empty());
    let plus1 = World::new(NOW).offset(|_| 3600);
    let mut os = vec![late.clone(), early.clone(), newest.clone()];
    assert_eq!(plus1.deleted(&mut os, &policy()), ids(&[&late]), "same local day: the newer one wins");
}

#[test]
fn dst_transition_is_exact_inside_one_utc_hour() {
    // Fall back at 00:30 UTC (+2h before, +1h after), tested in the hourly tier (3 h back).
    let hour0 = NOW - NOW % DAY_MS - 20 * HOUR_MS; // some UTC hour boundary
    let hour0 = hour0 - hour0 % HOUR_MS;
    let switch = hour0 + 30 * 60_000;
    let off = move |t: u64| if t < switch { 7200 } else { 3600 };
    let now = hour0 + 4 * HOUR_MS;
    let before = kf(hour0 + 10 * 60_000); // local 02:10 (hour 2)
    let after = kf(hour0 + 40 * 60_000); // local 01:40 (hour 1)
    let newest = kf(now);
    let w = World::new(now).offset(off);
    let mut os = vec![before.clone(), after.clone(), newest.clone()];
    assert!(w.deleted(&mut os, &policy()).is_empty(), "different local hours although one UTC hour");
    // Fall back across the hour boundary: UTC 00:50 (local 02:50) and 01:10 (local 02:10 again): same local hour.
    let sw = hour0 + HOUR_MS;
    let off2 = move |t: u64| if t < sw { 7200 } else { 3600 };
    let early = kf(hour0 + 50 * 60_000);
    let late = kf(hour0 + HOUR_MS + 10 * 60_000);
    let w = World::new(now).offset(off2);
    let mut os = vec![early.clone(), late.clone(), newest];
    assert_eq!(w.deleted(&mut os, &policy()), ids(&[&early]), "the repeated local hour is one bucket");
}

#[test]
fn weekly_forever_versus_n_weeks() {
    // One version per week for 12 weeks, Monday 10:00 and Wednesday 10:00 each week, ending 40 days ago.
    let mut v = Vec::new();
    for wk in 0..12u64 {
        for d in [0u64, 2] {
            v.push(kf(MON - 40 * DAY_MS - wk * WEEK_MS + d * DAY_MS + 10 * HOUR_MS));
        }
    }
    v.push(kf(NOW));
    let w = World::new(NOW);
    let forever = w.deleted(&mut v.clone(), &policy());
    assert_eq!(forever.len(), 12, "Monday copies go, the Wednesday of each week stays");
    let two = Policy::from_settings(&HistorySettings { keep_weekly_weeks: 2, ..Default::default() });
    let limited = w.deleted(&mut v.clone(), &two);
    let window_end = NOW - (30 * DAY_MS + 2 * WEEK_MS);
    let kept_old = v.iter().filter(|o| o.t < window_end && !limited.contains(&o.id)).count();
    assert_eq!(kept_old, 0, "nothing older than the weekly window survives");
    assert!(limited.len() > forever.len());
}

#[test]
fn weekly_buckets_start_on_monday_local() {
    // Sunday 23:00 and Monday 01:00 UTC are different weeks (UTC); at UTC-2 both are Sunday: one week.
    let sun = kf(MON - 42 * DAY_MS - HOUR_MS);
    let mon = kf(MON - 42 * DAY_MS + HOUR_MS);
    let newest = kf(NOW);
    let mut os = vec![sun.clone(), mon.clone(), newest.clone()];
    assert!(World::new(NOW).deleted(&mut os, &policy()).is_empty());
    let mut os = vec![sun.clone(), mon.clone(), newest];
    assert_eq!(World::new(NOW).offset(|_| -2 * 3600).deleted(&mut os, &policy()), ids(&[&sun]));
}

#[test]
fn newest_checkpoints_and_unknown_are_pinned() {
    let p = Policy::from_settings(&HistorySettings { keep_all_hours: 0, keep_hourly_hours: 0, keep_daily_days: 0, keep_weekly_weeks: 1, ..Default::default() });
    let w = World::new(NOW);
    let old = |d: u64| NOW - d * DAY_MS;
    let cp = reason(kf(old(400)), Reason::Checkpoint);
    let unknown = reason(kf(old(401)), Reason::Unknown('z'));
    let auto = kf(old(402));
    let base = kf(old(300));
    let cp_delta = reason(delta_on(old(299), &base), Reason::Checkpoint);
    let newest = kf(old(200));
    let mut os = vec![cp.clone(), unknown.clone(), auto.clone(), base.clone(), cp_delta.clone(), newest.clone()];
    let del = w.deleted(&mut os, &p);
    assert_eq!(del, ids(&[&auto]), "only the plain old automatic keyframe goes; the checkpoint delta pins its keyframe");
}

#[test]
fn kept_delta_pins_keyframe_and_leaves_go_before_keyframes() {
    let p = policy();
    let w = World::new(NOW);
    let base = kf(NOW - 10 * DAY_MS);
    // eight deltas on the same local day: only the newest stays, then its keyframe is needed
    let ds: Vec<O> = (0..8).map(|i| delta_on(NOW - 10 * DAY_MS + (i + 1) * 60_000, &base)).collect();
    let newest_d = ds.last().unwrap().clone();
    let mut os = vec![base.clone()];
    os.extend(ds.clone());
    let del = w.deleted(&mut os, &p);
    assert_eq!(sorted(del.clone()), sorted(ids(&ds[..7].iter().collect::<Vec<_>>())), "keyframe kept: the newest delta needs it");
    // A newer keyframe wins the day: the old keyframe is no longer needed and goes after its deltas.
    let newer = kf(NOW - 10 * DAY_MS + 30 * 60_000);
    let mut os = vec![base.clone()];
    os.extend(ds);
    os.push(newer);
    let plan = w.plan(&mut os, &p);
    assert_eq!(plan.len(), 9);
    assert!(plan[..8].iter().all(|d| !d.keyframe) && plan[8].keyframe, "leaves, then keyframes");
    let _ = newest_d;
}

#[test]
fn foreign_deltas_may_go_but_foreign_keyframes_are_protected() {
    let w = World::new(NOW).unseen(OTHER, 1);
    let fk = dev(kf(NOW - 90 * DAY_MS), OTHER);
    let fd1 = dev(delta_on(NOW - 90 * DAY_MS + 60_000, &fk), OTHER);
    let fd2 = dev(delta_on(NOW - 90 * DAY_MS + 120_000, &fk), OTHER);
    let mine = kf(NOW - 60_000);
    let mut os = vec![fk.clone(), fd1.clone(), fd2.clone(), mine];
    // fd2 is newest of its day-bucket? both fall in one daily bucket... fd2 (newer) is kept by weekly, fd1 goes
    let del = w.deleted(&mut os, &policy());
    assert!(del.contains(&fd1.id) && !del.contains(&fk.id) && !del.contains(&fd2.id));
}

fn takeover_case(unseen_days: u64, kf_age_days: u64, newest_after_days: Option<u64>) -> bool {
    let k = dev(kf(NOW - kf_age_days * DAY_MS), OTHER);
    let mut w = World::new(NOW).unseen(OTHER, unseen_days);
    if let Some(d) = newest_after_days {
        w = w.newest(OTHER, k.t + d * DAY_MS);
    }
    // a second foreign keyframe later in the same week keeps `k` from being the weekly winner
    let later = dev(kf(k.t + 1000), OTHER);
    let mine = kf(NOW - 60_000);
    let mut os = vec![k.clone(), later, mine];
    w.deleted(&mut os, &policy()).contains(&k.id)
}

#[test]
fn foreign_keyframe_takeover_rules() {
    // unseen >= 30 d, age >= 30 d, device moved past the keyframe by >= 7 d
    assert!(takeover_case(31, 40, Some(8)));
    assert!(takeover_case(30, 30, Some(7)), "boundaries are inclusive");
    // each condition alone fails
    assert!(!takeover_case(29, 40, Some(8)), "seen within 30 days");
    assert!(!takeover_case(31, 29, Some(8)), "keyframe younger than 30 days");
    assert!(!takeover_case(31, 40, Some(6)), "the device could still delta against it");
    assert!(!takeover_case(31, 40, None), "no file of the device seen after it");
    // dead device: 180 d unseen needs no proof of moving on
    assert!(takeover_case(180, 200, None));
    assert!(!takeover_case(179, 200, None));
}

#[test]
fn takeover_never_takes_a_referenced_or_kept_foreign_keyframe() {
    let k = dev(kf(NOW - 200 * DAY_MS), OTHER);
    let d = dev(delta_on(NOW - 200 * DAY_MS + 60_000, &k), OTHER); // lineage newest? no: mine is newer
    let w = World::new(NOW).unseen(OTHER, 365).newest(OTHER, NOW);
    // the delta is the only weekly winner of its week (kept) -> its keyframe stays
    let mine = kf(NOW - 60_000);
    let mut os = vec![k.clone(), d.clone(), mine];
    let del = w.deleted(&mut os, &policy());
    assert!(!del.contains(&k.id) && !del.contains(&d.id));
    // an unknown-reason foreign delta pins it too
    let u = reason(dev(delta_on(NOW - 199 * DAY_MS, &k), OTHER), Reason::Unknown('q'));
    let mut os = vec![k.clone(), d.clone(), u.clone(), kf(NOW)];
    assert!(!w.deleted(&mut os, &policy()).contains(&k.id));
}

#[test]
fn clock_skew_of_forty_days_cannot_unprotect_files() {
    // +40 d: the device writes future ULIDs; its keyframe never looks 30 d old, however unseen.
    let ahead = dev(kf(NOW + 40 * DAY_MS), OTHER);
    let ahead2 = dev(kf(NOW + 40 * DAY_MS + 1000), OTHER);
    let w = World::new(NOW).unseen(OTHER, 400).newest(OTHER, NOW + 90 * DAY_MS);
    let mut os = vec![ahead.clone(), ahead2, kf(NOW - 60_000)];
    assert!(!w.deleted(&mut os, &policy()).contains(&ahead.id));
    // -40 d: its files look old (ULID), but it was seen locally a minute ago -> protected.
    let behind = dev(kf(NOW - 70 * DAY_MS), OTHER);
    let behind2 = dev(kf(NOW - 70 * DAY_MS + 1000), OTHER);
    let w = World::new(NOW).unseen(OTHER, 0).newest(OTHER, NOW - 40 * DAY_MS);
    let mut os = vec![behind.clone(), behind2, kf(NOW - 60_000)];
    assert!(!w.deleted(&mut os, &policy()).contains(&behind.id));
}

#[test]
fn path_records_go_only_when_a_retained_newer_entry_has_a_path() {
    let w = World::new(NOW);
    let mut v1 = kf(NOW - 100 * DAY_MS);
    v1.path = Some("a.excalidraw");
    let mut v2 = kf(NOW - 60_000);
    v2.path = Some("b.excalidraw");
    let p1 = pm(NOW - 50 * DAY_MS, Some("b.excalidraw"));
    let p2 = pm(NOW - 40 * DAY_MS, Some("b.excalidraw"));
    let mut os = vec![v1.clone(), p1.clone(), p2.clone(), v2.clone()];
    assert_eq!(sorted(w.deleted(&mut os, &policy())), sorted(ids(&[&p1, &p2])));
    // heads missing: leave them alone
    let mut v2n = v2.clone();
    v2n.path = None;
    let mut os = vec![v1.clone(), p1.clone(), p2.clone(), v2n];
    let del = w.deleted(&mut os, &policy());
    assert!(!del.contains(&p2.id) && !del.contains(&p1.id) || del == ids(&[&p1]), "{del:?}");
    // a newest path record is never deleted
    let mut os = vec![v1, v2, pm(NOW - 10_000, Some("c.excalidraw"))];
    assert!(w.deleted(&mut os, &policy()).is_empty());
}

fn cap_run(os: Vec<Vec<O>>, excess: u64) -> (Vec<(usize, String, bool)>, u64) {
    let mut os = os;
    let vs: Vec<Vec<V>> = os.iter_mut().map(|o| views(o)).collect();
    let sl: Vec<&[V]> = vs.iter().map(|v| v.as_slice()).collect();
    let (plan, freed) = retention::plan_cap(&sl, excess, ME);
    (plan.iter().map(|c| (c.lineage, vs[c.lineage][c.idx].id.to_string(), c.keyframe)).collect(), freed)
}

#[test]
fn cap_deletes_oldest_deltas_vault_wide_never_a_lineages_newest() {
    let k1 = kf(1_000);
    let k2 = kf(2_000);
    let a = vec![k1.clone(), delta_on(3_000, &k1), delta_on(5_000, &k1), delta_on(9_000, &k1)];
    let b = vec![k2.clone(), delta_on(4_000, &k2), delta_on(6_000, &k2)];
    let (plan, freed) = cap_run(vec![a.clone(), b.clone()], 2500);
    assert_eq!(freed, 3000);
    assert_eq!(plan.iter().map(|p| (p.0, p.2)).collect::<Vec<_>>(), vec![(0, false), (1, false), (0, false)], "times 3000, 4000, 5000");
    // asking for everything: both newest deltas stay, the keyframes they need stay
    let (plan, freed) = cap_run(vec![a, b], u64::MAX);
    assert_eq!(plan.len(), 3, "a: 3000 and 5000, b: 4000 (6000 and 9000 are newest)");
    assert_eq!(freed, 3000);
}

#[test]
fn cap_then_unreferenced_own_keyframes_not_checkpoints_not_foreign_not_newest() {
    let old_kf = kf(1_000);
    let cp = reason(kf(1_500), Reason::Checkpoint);
    let foreign = dev(kf(1_600), OTHER);
    let k = kf(2_000);
    // old_kf has no deltas; k is referenced by the newest delta
    let a = vec![old_kf.clone(), cp, foreign, k.clone(), delta_on(3_000, &k)];
    let (plan, freed) = cap_run(vec![a], u64::MAX);
    assert_eq!(plan, vec![(0, old_kf.id.clone(), true)]);
    assert_eq!(freed, 1000);
    // a keyframe that is the lineage's newest version stays
    let (plan, _) = cap_run(vec![vec![kf(1_000), kf(2_000)]], u64::MAX);
    assert_eq!(plan.len(), 1);
}

#[test]
fn cap_deltas_before_keyframes_and_stops_at_the_goal() {
    let k = kf(1_000);
    let a = vec![k.clone(), delta_on(2_000, &k), delta_on(3_000, &k), kf(9_000)];
    let (plan, freed) = cap_run(vec![a], 1);
    assert_eq!(plan.len(), 1, "one delta is enough");
    assert_eq!(freed, 1000);
    let (plan, _) = cap_run(vec![vec![k.clone(), delta_on(2_000, &k), delta_on(3_000, &k), kf(9_000)]], 2500);
    assert_eq!(plan.iter().filter(|p| !p.2).count(), 2);
    assert_eq!(plan.iter().filter(|p| p.2).count(), 1, "then the freed keyframe");
}

#[test]
fn orphan_plan_keeps_checkpoints_and_what_they_need_but_not_the_newest() {
    let base = kf(1_000);
    let cp = reason(delta_on(2_000, &base), Reason::Checkpoint);
    let a = kf(3_000);
    let b = delta_on(4_000, &a);
    let mut os = vec![base.clone(), cp.clone(), a.clone(), b.clone()];
    let v = views(&mut os);
    let none = |_: &str| None;
    let zero = |_: &str| 0;
    let off = |_: u64| 0;
    let env = Env { now: NOW, me: ME, offset_secs: &off, last_seen: &none, newest_of: &zero };
    let plan = retention::plan_orphan(&v, &env);
    let del: Vec<&str> = plan.iter().map(|d| v[d.idx].id).collect();
    assert_eq!(del, vec![b.id.as_str(), a.id.as_str()], "automatic delta, then its keyframe; the checkpoint and its keyframe stay");
}

#[test]
fn local_offset_is_sane() {
    let o = retention::local_offset_secs(NOW);
    assert!((-14 * 3600..=14 * 3600).contains(&o));
}

// ------------------------------------------------------------------------------------------
// Benches
// ------------------------------------------------------------------------------------------

fn profile() -> String {
    std::env::var("HISTORY_PERF_PROFILE").unwrap_or_else(|_| "normal".into())
}
fn pct(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() as f64 - 1.0) * p).round() as usize]
}

/// `n` versions over `days` days: a keyframe, then deltas (rotation every 50), 1 in 40 a checkpoint.
fn synth(n: usize, days: u64, seed: u64) -> Vec<O> {
    let mut r = super::support::Rng(seed | 1);
    let mut out: Vec<O> = Vec::with_capacity(n);
    let span = days * DAY_MS;
    let mut ts: Vec<u64> = (0..n).map(|_| NOW - (r.next() % span)).collect();
    ts.sort_unstable();
    let mut cur: Option<O> = None;
    let mut count = 0;
    for t in ts {
        if cur.is_none() || count >= 50 {
            let k = kf(t);
            out.push(k.clone());
            cur = Some(k);
            count = 0;
        } else {
            let mut d = delta_on(t, cur.as_ref().unwrap());
            if r.below(40) == 0 {
                d.reason = Reason::Checkpoint;
            }
            out.push(d);
            count += 1;
        }
    }
    for (i, o) in out.iter_mut().enumerate() {
        o.id = id_at(o.t, i % 10_000);
        if let Some(k) = &mut o.kind {
            // re-point deltas at their keyframe's rewritten id
            let _ = k;
        }
    }
    // rebuild references after id rewrite: a delta's key is the nearest preceding keyframe
    let mut key = String::new();
    for o in out.iter_mut() {
        if o.kind.is_none() {
            key = o.id.clone();
        } else {
            o.kind = Some(key.clone());
        }
    }
    out
}

#[test]
#[ignore]
fn bench_retention_lineage_and_vault10k() {
    let w = World::new(NOW).offset(retention::local_offset_secs);
    let p = policy();
    let mut base = synth(500, 14, 7);
    let v = views(&mut base);
    let ls = |_: &str| None;
    let nw = |_: &str| 0u64;
    let env = Env { now: NOW, me: ME, offset_secs: &retention::local_offset_secs, last_seen: &ls, newest_of: &nw };
    for _ in 0..200 {
        std::hint::black_box(retention::plan(&v, &p, &env));
    }
    let mut samples = Vec::new();
    for _ in 0..3000 {
        let t0 = std::time::Instant::now();
        let r = retention::plan(&v, &p, &env);
        samples.push(t0.elapsed().as_nanos() as f64 / 1000.0);
        std::hint::black_box(r);
    }
    let (p50, p95, max, n) = (pct(&mut samples, 0.5), pct(&mut samples, 0.95), pct(&mut samples, 1.0), samples.len());
    println!("HISTORY_PERF {{\"metric\":\"history.retention.lineage\",\"unit\":\"us\",\"p50\":{p50:.3},\"p95\":{p95:.3},\"max\":{max:.3},\"n\":{n},\"profile\":\"{}\"}}", profile());

    // 10k versions in 40 lineages of 250: full plan for each lineage + the vault-wide cap plan
    let mut lins: Vec<Vec<O>> = (0..40).map(|i| synth(250, 60, 100 + i)).collect();
    let mut chunks = Vec::new();
    let mut totals = Vec::new();
    for _ in 0..20 {
        let t_all = std::time::Instant::now();
        let mut worst = 0f64;
        let mut dels = 0;
        let vs: Vec<Vec<V>> = lins.iter_mut().map(|l| views(l)).collect();
        for l in &vs {
            let t0 = std::time::Instant::now();
            dels += retention::plan(l, &p, &env).len();
            worst = worst.max(t0.elapsed().as_secs_f64() * 1000.0);
        }
        let t0 = std::time::Instant::now();
        let sl: Vec<&[V]> = vs.iter().map(|v| v.as_slice()).collect();
        let (c, _) = retention::plan_cap(&sl, 5_000_000, ME);
        worst = worst.max(t0.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box((dels, c.len()));
        totals.push(t_all.elapsed().as_secs_f64() * 1000.0);
        chunks.push(worst);
    }
    let max_chunk = pct(&mut chunks, 1.0);
    let (p50, p95, max, n) = (pct(&mut totals, 0.5), pct(&mut totals, 0.95), pct(&mut totals, 1.0), totals.len());
    println!("HISTORY_PERF {{\"metric\":\"history.retention.vault10k\",\"unit\":\"ms\",\"p50\":{p50:.3},\"p95\":{p95:.3},\"max\":{max:.3},\"n\":{n},\"max_chunk_ms\":{max_chunk:.3},\"profile\":\"{}\"}}", profile());
    let _ = w;
}
