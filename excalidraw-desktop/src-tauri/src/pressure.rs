//! macOS memory-pressure notifications.
//!
//! A libdispatch `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` source (the same mechanism WebKit
//! and Chromium use) fires when the kernel reports WARN or CRITICAL pressure. We return
//! our own free malloc pages and tell the webview, which purges its rebuildable caches.
//! Everything is a no-op outside macOS.
use serde::Serialize;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Emitter;

use crate::memory;

/// Event the webview listens to.
pub const EVENT: &str = "memory-pressure";

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct PressurePayload {
    pub level: &'static str,
}

/// Maps `DISPATCH_MEMORYPRESSURE_*` flags (NORMAL 1, WARN 2, CRITICAL 4) to a level name.
fn level_from_flags(flags: usize) -> Option<&'static str> {
    if flags & 0x4 != 0 {
        Some("critical")
    } else if flags & 0x2 != 0 {
        Some("warn")
    } else {
        None
    }
}

/// Called by the webview after it purged its own caches (hidden or idle): returns freed
/// native memory. Runs off the main thread.
#[tauri::command]
pub async fn release_memory() {
    let _ = tauri::async_runtime::spawn_blocking(memory::release_free_memory).await;
}

/// Subscribe to system memory pressure. The source lives for the whole process.
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::start(app.clone());
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::ffi::c_void;

    type Source = *mut c_void;
    const MASK_WARN_CRITICAL: usize = 0x2 | 0x4;
    const QOS_CLASS_UTILITY: u32 = 0x11;

    #[link(name = "System", kind = "dylib")]
    extern "C" {
        static _dispatch_source_type_memorypressure: c_void;
        fn dispatch_get_global_queue(identifier: isize, flags: usize) -> *mut c_void;
        fn dispatch_source_create(kind: *const c_void, handle: usize, mask: usize, queue: *mut c_void) -> Source;
        fn dispatch_set_context(object: *mut c_void, context: *mut c_void);
        fn dispatch_source_set_event_handler_f(source: Source, handler: extern "C" fn(*mut c_void));
        fn dispatch_source_get_data(source: Source) -> usize;
        fn dispatch_resume(object: *mut c_void);
    }

    struct Context {
        app: AppHandle,
        source: Source,
    }

    extern "C" fn on_event(ctx: *mut c_void) {
        // SAFETY: `ctx` is the leaked `Context` set in `start`; it is never freed or mutated.
        let ctx = unsafe { &*(ctx as *const Context) };
        // SAFETY: the source outlives the process.
        let flags = unsafe { dispatch_source_get_data(ctx.source) };
        if let Some(level) = level_from_flags(flags) {
            memory::release_free_memory();
            let _ = ctx.app.emit(EVENT, PressurePayload { level });
        }
    }

    pub fn start(app: AppHandle) {
        // SAFETY: plain libdispatch calls; the context is leaked on purpose so it outlives the source.
        unsafe {
            let queue = dispatch_get_global_queue(QOS_CLASS_UTILITY as isize, 0);
            let source = dispatch_source_create(
                &_dispatch_source_type_memorypressure as *const c_void,
                0,
                MASK_WARN_CRITICAL,
                queue,
            );
            if source.is_null() {
                eprintln!("vaultdraw: memory pressure source not created");
                return;
            }
            let ctx = Box::into_raw(Box::new(Context { app, source }));
            dispatch_set_context(source, ctx as *mut c_void);
            dispatch_source_set_event_handler_f(source, on_event);
            dispatch_resume(source);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_flags_to_levels() {
        assert_eq!(level_from_flags(0x1), None);
        assert_eq!(level_from_flags(0x2), Some("warn"));
        assert_eq!(level_from_flags(0x4), Some("critical"));
        assert_eq!(level_from_flags(0x6), Some("critical"));
    }

    #[test]
    fn payload_shape() {
        let json = serde_json::to_string(&PressurePayload { level: "warn" }).unwrap();
        assert_eq!(json, r#"{"level":"warn"}"#);
        assert_eq!(EVENT, "memory-pressure");
    }

    #[test]
    fn release_command_runs() {
        tauri::async_runtime::block_on(release_memory());
    }
}
