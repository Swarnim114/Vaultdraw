//! Regression tests for the foreign-blob takeover rule (a foreign copy goes only when NO known
//! header references the sha) and for the resumable sweep's reference refresh (`Index::refs_gen`).
//! Built on the two-replica harness of `sync_h3_tests`.
use super::{
    support::*,
    sync_h3_tests::{exact, off0, Dev, Net, P},
};
use crate::history::{
    gc::{self, Sweep},
    names::Reason,
    retention::{DAY_MS, HOUR_MS},
};
use std::time::Duration;

/// The scene without its images (and the files they embed).
fn plain(sc: &Scene) -> Scene {
    let mut s = sc.clone();
    s.elements.retain(|e| e["type"] != "image");
    s.files.clear();
    s
}

fn blobs_of(d: &Dev, dev: &str) -> usize {
    d.blobs().iter().filter(|b| b.dev == dev).count()
}

/// A has its own copy of image X, B (foreign) a version referencing X with its copy in an old
/// epoch; B goes dead; A's sweep runs the takeover; A's own versions referencing X are thinned
/// away and A's own-blob GC runs (past the 1 h grace, two sweeps). B's version must still restore
/// byte-exact with its image on both replicas.
#[test]
fn takeover_then_own_blob_gc_never_leaves_a_foreign_version_without_its_image() {
    let mut devs = [Dev::new(T0), Dev::new(T0)];
    let mut net = Net::new(2, 3);
    let (a, b) = (devs[0].me.clone(), devs[1].me.clone());
    let sc = scene(1, 30, 1, 3000);
    let bjson = sc.json();
    let bid = devs[1].put("b.excalidraw", &bjson, Reason::Auto).id;
    // A: v1 and v2 reference X, v3 does not (one local day: only v3 survives thinning)
    let mut s2 = sc.clone();
    s2.edit();
    let mut s3 = plain(&s2);
    s3.edit();
    for (t, json) in [(1000, sc.json()), (60_000, s2.json()), (120_000, s3.json())] {
        devs[0].at(T0 + t);
        devs[0].put(P, &json, Reason::Auto);
    }
    devs.iter().for_each(|d| d.at(T0 + HOUR_MS));
    net.quiesce(&devs);
    assert_eq!((blobs_of(&devs[0], &a), blobs_of(&devs[0], &b)), (1, 1), "both copies of X on A");
    // B is dead for 200 days (A never observes a new file of B again)
    let t = T0 + 200 * DAY_MS;
    for h in [0, 2] {
        devs[0].at(t + h * HOUR_MS);
        devs[0].sweep();
    }
    assert_eq!(devs[0].version_ids().len(), 2, "A's v1/v2 were thinned; v3 and B's version are left");
    assert_eq!(blobs_of(&devs[0], &a), 0, "A's own copy of X was collected (no own header references it)");
    assert_eq!(blobs_of(&devs[0], &b), 1, "B's copy of X must survive: B's version references it");
    devs.iter().for_each(|d| d.at(t + 3 * HOUR_MS));
    net.quiesce(&devs);
    for d in &devs {
        assert_eq!(verify_all_versions(d.root()), 2);
        assert_eq!(exact(d, &bid), bjson.as_bytes(), "B's version restores with its image on {}", d.me);
        assert_eq!(blobs_of(d, &b), 1, "B's own copy is there on {}", d.me);
    }
    // more sweeps (daily, unattended) change nothing B needs
    for day in 1..=5 {
        devs[0].at(t + day * DAY_MS);
        devs[0].sweep();
    }
    net.quiesce(&devs);
    for d in &devs {
        assert_eq!(exact(d, &bid), bjson.as_bytes());
    }
}

/// The sweep stops after `k` units, a write reuses an own blob that was unreferenced when the
/// sweep took its reference snapshot, and the sweep resumes: the blob must not be deleted.
#[test]
fn a_sweep_paused_at_any_unit_never_deletes_a_blob_a_new_write_reuses() {
    let mut racy_pauses = 0;
    for k in 0..24usize {
        let mut d = Dev::new(T0);
        let sc = scene(3, 5, 1, 2000);
        let lin = d.put("img.excalidraw", &sc.json(), Reason::Auto).lineage;
        gc::delete_lineages(&d.ctx(), &[lin]).unwrap();
        assert_eq!(d.blobs().len(), 1);
        d.at(T0 + 10 * HOUR_MS);
        d.sweep(); // notes the blob as unreferenced
        assert_eq!(d.blobs().len(), 1, "the first sweep only notes the time");
        // the next sweep (well past the 1 h grace) runs k units, then a write reuses the blob
        d.at(T0 + 12 * HOUR_MS);
        d.rescan();
        let mut sweep = Sweep::new(&d.ctx());
        let mut done = false;
        for _ in 0..k {
            done = sweep.step_with(&d.ctx(), Duration::ZERO, &off0);
            if done {
                break;
            }
        }
        let blob_present = d.blobs().len() == 1;
        let mut again = sc.clone();
        again.edit();
        let json = again.json();
        let id = d.put("reuse.excalidraw", &json, Reason::Auto).id;
        while !done {
            done = sweep.step_with(&d.ctx(), Duration::ZERO, &off0);
        }
        if blob_present {
            racy_pauses += 1;
            assert_eq!(d.blobs().len(), 1, "k={k}: the resumed sweep deleted a blob the new version references");
        }
        assert_eq!(verify_all_versions(d.root()), 1, "k={k}");
        assert_eq!(exact(&d, &id), json.as_bytes(), "k={k}");
    }
    assert!(racy_pauses >= 8, "pause points must cover the sweep's own-blob phase ({racy_pauses})");
}
