//! Returning freed memory to the OS.
//!
//! macOS magazine malloc keeps freed large blocks (the 20-30 MB buffers made while
//! reading and writing big drawings) dirty in a free cache, and `phys_footprint`
//! counts them. `malloc_zone_pressure_relief` walks the free lists and returns those
//! pages to the kernel. It does not touch live allocations.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[cfg(target_os = "macos")]
extern "C" {
    fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
}

/// Release cached free memory in every malloc zone. No-op outside macOS.
pub fn release_free_memory() {
    #[cfg(target_os = "macos")]
    // SAFETY: a null zone means "all zones"; a zero goal means "release as much as possible".
    unsafe {
        malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
}

/// How long to wait so buffers freed when the IPC call finishes are already on the free list.
const RELEASE_DELAY: Duration = Duration::from_millis(250);
static RELEASE_PENDING: AtomicBool = AtomicBool::new(false);

/// Debounced, off-thread `release_free_memory`: bursts of saves share one pass, and the
/// IPC request/response buffers (freed only after the command returns) are included.
pub fn schedule_release() {
    if RELEASE_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(RELEASE_DELAY);
        RELEASE_PENDING.store(false, Ordering::Release);
        release_free_memory();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_is_cheap_after_large_free() {
        let big = vec![1u8; 22 * 1024 * 1024];
        std::hint::black_box(&big);
        drop(big);
        let start = std::time::Instant::now();
        release_free_memory();
        eprintln!("release_free_memory after 22 MB free: {:?}", start.elapsed());
    }

    #[test]
    fn schedule_is_debounced() {
        schedule_release();
        assert!(RELEASE_PENDING.load(Ordering::Acquire));
        schedule_release();
    }
}
