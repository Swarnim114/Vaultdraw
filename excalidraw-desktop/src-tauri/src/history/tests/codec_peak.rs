//! Peak-allocation probe for `strip` and `proven_delta` (counting global allocator).
//! The allocator is global to the test binary, so this module is compiled only with
//! `RUSTFLAGS="--cfg history_codec_peak"` (it would clash with any other counting allocator):
//!
//! `RUSTFLAGS="--cfg history_codec_peak" cargo test --release --offline history::tests::codec_peak -- --nocapture`
#![allow(unexpected_cfgs)]
use super::codec_support::*;
use crate::history::codec::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

static CUR: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

struct Counting;
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = System.alloc(l);
        if !p.is_null() {
            let c = CUR.fetch_add(l.size(), Relaxed) + l.size();
            PEAK.fetch_max(c, Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l);
        CUR.fetch_sub(l.size(), Relaxed);
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, new: usize) -> *mut u8 {
        let q = System.realloc(p, l, new);
        if !q.is_null() {
            let c = if new >= l.size() { CUR.fetch_add(new - l.size(), Relaxed) + new - l.size() } else { CUR.fetch_sub(l.size() - new, Relaxed) - (l.size() - new) };
            PEAK.fetch_max(c, Relaxed);
        }
        q
    }
}
#[global_allocator]
static ALLOC: Counting = Counting;

/// Extra peak bytes allocated by `f` above what was live when it started.
fn extra_peak<T>(f: impl FnOnce() -> T) -> (T, usize) {
    let base = CUR.load(Relaxed);
    PEAK.store(base, Relaxed);
    let v = f();
    (v, PEAK.load(Relaxed).saturating_sub(base))
}

fn emit(name: &str, extra: usize, file_len: usize) {
    let mb = extra as f64 / 1e6;
    println!(
        "HISTORY_PERF {{\"metric\":\"history.codec.peakMB.{name}\",\"unit\":\"MB\",\"p50\":{mb:.2},\"p95\":{mb:.2},\"max\":{mb:.2},\"n\":1,\"profile\":\"normal\",\"extraOverFile\":{:.3},\"fileMB\":{:.1}}}",
        extra as f64 / file_len as f64,
        file_len as f64 / 1e6
    );
}

#[test]
fn codec_peak() {
    let mut r = Rng::new(42);
    // 5kimg: ~25 MB with images
    let m = gen_scene(&mut r, 5000, 12, 1_400_000);
    let file = render(&m, Fmt::Compact, &mut r);
    drop(m);
    let (s, extra) = extra_peak(|| strip(&file, &mut NoMemo, &|_| true, "abcdefgh", "0abc").unwrap());
    emit("strip.5kimg", extra, file.len());
    // the output buffer is exactly the stripped text
    assert_eq!(s.text.capacity(), s.text.len());
    assert!(extra < s.text.len() + 4_000_000, "strip extra {extra} vs text {}", s.text.len());
    drop(s);
    drop(file);

    // ~26 MB, no images: strip and proven_delta with key + new live
    let mut m = gen_scene(&mut r, 43_000, 0, 0);
    let key = render(&m, Fmt::Compact, &mut r);
    for _ in 0..30 {
        let i = r.below(m.elements.len());
        m.elements[i].as_object_mut().unwrap().insert("x".into(), serde_json::json!(r.f()));
    }
    let new = render(&m, Fmt::Compact, &mut r);
    drop(m);
    let (s, extra) = extra_peak(|| strip(&new, &mut NoMemo, &|_| true, "abcdefgh", "0abc").unwrap());
    emit("strip.noimg", extra, new.len());
    let new_text = s.text;
    let key_text = strip(&key, &mut NoMemo, &|_| true, "abcdefgh", "0abc").unwrap().text;
    drop((key, new));
    let (d, extra) = extra_peak(|| proven_delta(&key_text, &new_text).expect("delta"));
    emit("proven_delta.noimg", extra, new_text.len());
    assert_eq!(reconstruct(&key_text, Some(&d)).unwrap(), new_text);
}
