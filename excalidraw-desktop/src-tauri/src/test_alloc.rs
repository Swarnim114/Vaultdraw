//! The counting global allocator for test builds. A crate can have only one
//! `#[global_allocator]`, so every bench that measures heap (links, file history)
//! reads its numbers from here.
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

static CURRENT: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

struct Counting;

fn grew(by: usize) {
    let now = CURRENT.fetch_add(by, Relaxed) + by;
    PEAK.fetch_max(now, Relaxed);
}

// SAFETY: forwards to the system allocator and only keeps counters.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = System.alloc(l);
        if !p.is_null() {
            grew(l.size());
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l);
        CURRENT.fetch_sub(l.size(), Relaxed);
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, new: usize) -> *mut u8 {
        let q = System.realloc(p, l, new);
        if !q.is_null() {
            if new >= l.size() {
                grew(new - l.size());
            } else {
                CURRENT.fetch_sub(l.size() - new, Relaxed);
            }
        }
        q
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

/// Bytes allocated right now.
pub(crate) fn live() -> usize {
    CURRENT.load(Relaxed)
}

/// Starts a peak window at the current live size and returns that base.
pub(crate) fn reset_peak() -> usize {
    let base = live();
    PEAK.store(base, Relaxed);
    base
}

/// The highest live size since the last `reset_peak`.
pub(crate) fn peak() -> usize {
    PEAK.load(Relaxed)
}
