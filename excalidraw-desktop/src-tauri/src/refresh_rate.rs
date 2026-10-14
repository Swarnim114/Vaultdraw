//! 120 Hz rendering on macOS.
//!
//! WebKit caps page rendering (requestAnimationFrame, canvas redraws) near
//! 60 fps by default, even on ProMotion displays. The cap is the private
//! WebKit feature `PreferPageRenderingUpdatesNear60FPSEnabled`, which only
//! takes effect when switched off before the web view exists.
//! [`disable_near_60fps_cap`] does that, reads the value back and logs the
//! outcome on every launch; a missing key is logged as a loud warning instead
//! of silently leaving the app at 60 fps.
//!
//! Test builds (`smoke-test`) also get the probes behind the refresh-rate
//! perf suite: display facts plus a CVDisplayLink sample
//! ([`perf_display_info`]) and native trackpad input posted through the real
//! WKWebView event path ([`perf_native_input`]).
use serde_json::{json, Value};
use std::sync::OnceLock;

pub const NEAR_60FPS_FEATURE: &str = "PreferPageRenderingUpdatesNear60FPSEnabled";

static FLAG_STATUS: OnceLock<Value> = OnceLock::new();

/// What happened to the 60 fps cap at launch (`{"checked": false}` before the window exists).
#[cfg_attr(not(feature = "smoke-test"), allow(dead_code))]
pub fn flag_status() -> Value {
    FLAG_STATUS.get().cloned().unwrap_or_else(|| json!({ "checked": false }))
}

/// Feature keys worth listing next to the cap, so a renamed key is easy to spot in the log.
#[cfg(any(test, target_os = "macos"))]
fn is_related_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.contains("60fps") || k.contains("renderingupdate") || k.contains("framerate")
}

/// One-line launch log for the cap; `None` = keep quiet (applied as expected).
#[cfg(any(test, target_os = "macos"))]
fn status_line(found: bool, applied: bool, readback: Option<bool>, related: &[String]) -> String {
    if found && applied && readback == Some(false) {
        return format!("vaultdraw: 120 Hz: WebKit {NEAR_60FPS_FEATURE} disabled (read back: off)");
    }
    format!(
        "vaultdraw: WARNING: 120 Hz NOT enabled: WebKit {NEAR_60FPS_FEATURE} found={found} applied={applied} \
         readback={readback:?}; page rendering stays capped near 60 fps. Related feature keys: [{}]",
        related.join(", ")
    )
}

/// Switches the near-60fps cap off in `prefs` (before the web view is created), records and logs the result.
#[cfg(all(target_os = "macos", not(test)))]
pub fn disable_near_60fps_cap(prefs: &objc2_web_kit::WKPreferences) {
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{msg_send, sel, ClassType};
    use objc2_foundation::NSString;

    let prefs_class: &AnyClass = objc2_web_kit::WKPreferences::class();
    let has_features: bool = unsafe { msg_send![prefs_class, respondsToSelector: sel!(_features)] };
    let can_set: bool = unsafe { msg_send![prefs, respondsToSelector: sel!(_setEnabled:forFeature:)] };
    let can_read: bool = unsafe { msg_send![prefs, respondsToSelector: sel!(_isEnabledForFeature:)] };
    let mut found = false;
    let mut applied = false;
    let mut readback = None;
    let mut related = Vec::new();
    if has_features {
        unsafe {
            let features: *mut AnyObject = msg_send![prefs_class, _features];
            if !features.is_null() {
                let count: usize = msg_send![features, count];
                for index in 0..count {
                    let feature: *mut AnyObject = msg_send![features, objectAtIndex: index];
                    let key: *mut NSString = msg_send![feature, key];
                    if key.is_null() {
                        continue;
                    }
                    let key = (*key).to_string();
                    if is_related_key(&key) {
                        related.push(key.clone());
                    }
                    if key != NEAR_60FPS_FEATURE {
                        continue;
                    }
                    found = true;
                    if can_set {
                        let _: () = msg_send![prefs, _setEnabled: Bool::NO, forFeature: feature];
                        applied = true;
                    }
                    if can_read {
                        let on: Bool = msg_send![prefs, _isEnabledForFeature: feature];
                        readback = Some(on.as_bool());
                    }
                }
            }
        }
    }
    eprintln!("{}", status_line(found, applied, readback, &related));
    let _ = FLAG_STATUS.set(json!({
        "checked": true,
        "key": NEAR_60FPS_FEATURE,
        "found": found,
        "applied": applied,
        "readback": readback,
        "relatedKeys": related,
    }));
}

#[cfg(all(feature = "smoke-test", not(target_os = "macos")))]
pub mod probes {
    #[tauri::command]
    pub async fn perf_display_info() -> Result<serde_json::Value, String> {
        Err("refresh-rate probes are macOS only".into())
    }
    #[tauri::command]
    pub async fn perf_native_input() -> Result<serde_json::Value, String> {
        Err("refresh-rate probes are macOS only".into())
    }
    #[tauri::command]
    pub fn perf_window_maximize() -> Result<serde_json::Value, String> {
        Err("refresh-rate probes are macOS only".into())
    }
    #[tauri::command]
    pub fn perf_process_cpu() -> Result<serde_json::Value, String> {
        Err("refresh-rate probes are macOS only".into())
    }
}

/// Test-build probes. Every private or unusual call is guarded and reported, never fatal.
#[cfg(all(feature = "smoke-test", target_os = "macos"))]
pub mod probes {
    use super::*;
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send, Encode, Encoding};
    use std::ffi::c_void;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default)]
    struct Pt {
        x: f64,
        y: f64,
    }
    unsafe impl Encode for Pt {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }
    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default)]
    struct Sz {
        w: f64,
        h: f64,
    }
    unsafe impl Encode for Sz {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }
    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default)]
    struct Rect {
        origin: Pt,
        size: Sz,
    }
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[Pt::ENCODING, Sz::ENCODING]);
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CVTime {
        time_value: i64,
        time_scale: i32,
        flags: i32,
    }

    type CVCallback =
        extern "C" fn(*mut c_void, *const c_void, *const c_void, u64, *mut u64, *mut c_void) -> i32;

    #[link(name = "CoreVideo", kind = "framework")]
    extern "C" {
        fn CVDisplayLinkCreateWithCGDisplay(display: u32, out: *mut *mut c_void) -> i32;
        fn CVDisplayLinkSetOutputCallback(link: *mut c_void, cb: CVCallback, ctx: *mut c_void) -> i32;
        fn CVDisplayLinkStart(link: *mut c_void) -> i32;
        fn CVDisplayLinkStop(link: *mut c_void) -> i32;
        fn CVDisplayLinkRelease(link: *mut c_void);
        fn CVDisplayLinkGetActualOutputVideoRefreshPeriod(link: *mut c_void) -> f64;
        fn CVDisplayLinkGetNominalOutputVideoRefreshPeriod(link: *mut c_void) -> CVTime;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventCreateScrollWheelEvent2(
            source: *const c_void,
            units: u32,
            wheel_count: u32,
            wheel1: i32,
            wheel2: i32,
            wheel3: i32,
        ) -> *mut c_void;
        fn CGEventSetIntegerValueField(event: *mut c_void, field: u32, value: i64);
        fn CGEventSetDoubleValueField(event: *mut c_void, field: u32, value: f64);
        fn CGEventSetLocation(event: *mut c_void, point: Pt);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }

    extern "C" fn on_display_frame(
        _link: *mut c_void,
        _now: *const c_void,
        _output: *const c_void,
        _flags_in: u64,
        _flags_out: *mut u64,
        ctx: *mut c_void,
    ) -> i32 {
        let ticks = unsafe { &*(ctx as *const Mutex<Vec<Instant>>) };
        if let Ok(mut t) = ticks.lock() {
            t.push(Instant::now());
        }
        0
    }

    /// Callback rate of a CVDisplayLink on the main display over `ms`: the screen's real refresh cadence.
    fn sample_display_link(ms: u64) -> Value {
        let ticks: Arc<Mutex<Vec<Instant>>> = Arc::new(Mutex::new(Vec::new()));
        let mut link: *mut c_void = std::ptr::null_mut();
        unsafe {
            if CVDisplayLinkCreateWithCGDisplay(CGMainDisplayID(), &mut link) != 0 || link.is_null() {
                return json!({ "error": "CVDisplayLinkCreateWithCGDisplay failed" });
            }
            let ctx = Arc::as_ptr(&ticks) as *mut c_void;
            CVDisplayLinkSetOutputCallback(link, on_display_frame, ctx);
            CVDisplayLinkStart(link);
        }
        std::thread::sleep(Duration::from_millis(ms));
        let (actual, nominal) = unsafe {
            CVDisplayLinkStop(link);
            let actual = CVDisplayLinkGetActualOutputVideoRefreshPeriod(link);
            let n = CVDisplayLinkGetNominalOutputVideoRefreshPeriod(link);
            CVDisplayLinkRelease(link);
            (actual, if n.time_value > 0 { n.time_scale as f64 / n.time_value as f64 } else { 0.0 })
        };
        let t = ticks.lock().map(|t| t.clone()).unwrap_or_default();
        let hz = if t.len() > 1 {
            (t.len() - 1) as f64 / (t[t.len() - 1] - t[0]).as_secs_f64()
        } else {
            0.0
        };
        json!({
            "callbacks": t.len(),
            "measuredHz": (hz * 10.0).round() / 10.0,
            "nominalHz": (nominal * 10.0).round() / 10.0,
            "actualHz": if actual > 0.0 { ((10.0 / actual).round()) / 10.0 } else { 0.0 },
        })
    }

    unsafe fn ns_string(obj: *mut AnyObject) -> Option<String> {
        if obj.is_null() {
            return None;
        }
        Some((*(obj as *mut objc2_foundation::NSString)).to_string())
    }

    /// Facts read on the main thread: the window's screen, power state, WebKit version, the live flag.
    unsafe fn display_facts(webview: *mut c_void, ns_window: *mut c_void) -> Value {
        let mut out = serde_json::Map::new();
        let window = ns_window as *mut AnyObject;
        if !window.is_null() {
            let screen: *mut AnyObject = msg_send![window, screen];
            if !screen.is_null() {
                let max_fps: isize = msg_send![screen, maximumFramesPerSecond];
                let min_interval: f64 = msg_send![screen, minimumRefreshInterval];
                let max_interval: f64 = msg_send![screen, maximumRefreshInterval];
                let name: *mut AnyObject = msg_send![screen, localizedName];
                out.insert("screenMaxFps".into(), json!(max_fps));
                out.insert("screenMinRefreshIntervalMs".into(), json!(min_interval * 1000.0));
                out.insert("screenMaxRefreshIntervalMs".into(), json!(max_interval * 1000.0));
                out.insert("screenName".into(), json!(ns_string(name)));
            }
            let occlusion: usize = msg_send![window, occlusionState];
            let key: Bool = msg_send![window, isKeyWindow];
            let visible: Bool = msg_send![window, isVisible];
            out.insert("windowVisibleOcclusionBit".into(), json!(occlusion & 2 != 0));
            out.insert("windowIsKey".into(), json!(key.as_bool()));
            out.insert("windowIsVisible".into(), json!(visible.as_bool()));
            let frame: Rect = msg_send![window, frame];
            out.insert("windowSize".into(), json!([frame.size.w, frame.size.h]));
            let scale: f64 = msg_send![window, backingScaleFactor];
            out.insert("backingScale".into(), json!(scale));
        }
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        if !info.is_null() {
            let low: Bool = msg_send![info, isLowPowerModeEnabled];
            out.insert("lowPowerMode".into(), json!(low.as_bool()));
            let thermal: isize = msg_send![info, thermalState];
            out.insert("thermalState".into(), json!(thermal));
        }
        let bundle_id = objc2_foundation::NSString::from_str("com.apple.WebKit");
        let bundle: *mut AnyObject = msg_send![class!(NSBundle), bundleWithIdentifier: &*bundle_id];
        if !bundle.is_null() {
            let key = objc2_foundation::NSString::from_str("CFBundleVersion");
            let version: *mut AnyObject = msg_send![bundle, objectForInfoDictionaryKey: &*key];
            out.insert("webkitVersion".into(), json!(ns_string(version)));
        }
        // The flag as the live web view sees it (the launch value can't be changed afterwards).
        let view = webview as *mut AnyObject;
        if !view.is_null() {
            let config: *mut AnyObject = msg_send![view, configuration];
            let prefs: *mut AnyObject = if config.is_null() { config } else { msg_send![config, preferences] };
            let features: *mut AnyObject = msg_send![class!(WKPreferences), _features];
            if !prefs.is_null() && !features.is_null() {
                let count: usize = msg_send![features, count];
                for index in 0..count {
                    let feature: *mut AnyObject = msg_send![features, objectAtIndex: index];
                    let key: *mut AnyObject = msg_send![feature, key];
                    if ns_string(key).as_deref() == Some(NEAR_60FPS_FEATURE) {
                        let on: Bool = msg_send![prefs, _isEnabledForFeature: feature];
                        out.insert("liveNear60fpsEnabled".into(), json!(on.as_bool()));
                    }
                }
            }
        }
        Value::Object(out)
    }

    /// Display facts, the launch-time flag status and a CVDisplayLink sample of `sample_ms` (default 500).
    #[tauri::command]
    pub async fn perf_display_info(window: tauri::WebviewWindow, sample_ms: Option<u64>) -> Result<Value, String> {
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .with_webview(move |webview| {
                let _ = tx.send(unsafe { display_facts(webview.inner(), webview.ns_window()) });
            })
            .map_err(|e| e.to_string())?;
        let facts = rx.recv_timeout(Duration::from_secs(5)).unwrap_or(Value::Null);
        let ms = sample_ms.unwrap_or(500).clamp(100, 5000);
        let link = tauri::async_runtime::spawn_blocking(move || sample_display_link(ms))
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({ "flag": flag_status(), "display": facts, "displayLink": link }))
    }

    /// Fills the screen's visible area (the user's usual full-size window); returns the inner size.
    #[tauri::command]
    pub fn perf_window_maximize(window: tauri::WebviewWindow) -> Result<Value, String> {
        window.maximize().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        Ok(json!({ "width": size.width, "height": size.height }))
    }

    /// Cumulative CPU seconds per pid (`ps` TIME), to attribute a pass's cost to the app,
    /// WebContent and GPU processes.
    #[tauri::command]
    pub fn perf_process_cpu(pids: Vec<i32>) -> Result<Value, String> {
        let list: Vec<String> = pids.iter().filter(|p| **p > 0).map(|p| p.to_string()).collect();
        if list.is_empty() {
            return Ok(json!({}));
        }
        let out = std::process::Command::new("/bin/ps")
            .args(["-o", "pid=,time=", "-p", &list.join(",")])
            .output()
            .map_err(|e| e.to_string())?;
        let mut map = serde_json::Map::new();
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let mut parts = line.split_whitespace();
            if let (Some(pid), Some(time)) = (parts.next(), parts.next()) {
                if let Some(secs) = parse_cpu_time(time) {
                    map.insert(pid.to_string(), json!(secs));
                }
            }
        }
        Ok(Value::Object(map))
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Kind {
        Scroll,
        Magnify,
    }

    /// CG/IOHID phase bits: began 1, changed 2, ended 4.
    const PHASE_BEGAN: i64 = 1;
    const PHASE_CHANGED: i64 = 2;
    const PHASE_ENDED: i64 = 4;

    /// Converts a CSS point in the web view to the window point AppKit hit-tests.
    unsafe fn window_point(view: *mut AnyObject, x: f64, y: f64) -> Pt {
        let flipped: Bool = msg_send![view, isFlipped];
        let bounds: Rect = msg_send![view, bounds];
        let local = Pt { x, y: if flipped.as_bool() { y } else { bounds.size.h - y } };
        let nil: *mut AnyObject = std::ptr::null_mut();
        msg_send![view, convertPoint: local, toView: nil]
    }

    unsafe fn primary_screen_height() -> f64 {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        let first: *mut AnyObject = if screens.is_null() { screens } else { msg_send![screens, firstObject] };
        if first.is_null() {
            return 0.0;
        }
        let frame: Rect = msg_send![first, frame];
        frame.size.h
    }

    /// Builds the NSEvent (autoreleased) for one input step; `None` if AppKit rejects it.
    unsafe fn make_event(kind: Kind, phase: i64, value: f64, cg_location: Pt) -> Option<*mut AnyObject> {
        let event = match kind {
            Kind::Scroll => {
                // Continuous (trackpad) pixel scroll: wheel1 = y, wheel2 = x.
                let e = CGEventCreateScrollWheelEvent2(std::ptr::null(), 0, 2, value.round() as i32, 0, 0);
                if e.is_null() {
                    return None;
                }
                CGEventSetIntegerValueField(e, 88, 1); // kCGScrollWheelEventIsContinuous
                CGEventSetIntegerValueField(e, 99, phase); // kCGScrollWheelEventScrollPhase
                CGEventSetIntegerValueField(e, 123, 0); // kCGScrollWheelEventMomentumPhase
                e
            }
            Kind::Magnify => {
                let e = CGEventCreate(std::ptr::null());
                if e.is_null() {
                    return None;
                }
                CGEventSetIntegerValueField(e, 55, 29); // type: NSEventTypeGesture
                CGEventSetIntegerValueField(e, 110, 8); // gesture HID type: zoom
                CGEventSetIntegerValueField(e, 132, phase);
                CGEventSetDoubleValueField(e, 113, value); // magnification delta
                e
            }
        };
        CGEventSetLocation(event, cg_location);
        let ns: *mut AnyObject = msg_send![class!(NSEvent), eventWithCGEvent: event];
        CFRelease(event);
        (!ns.is_null()).then_some(ns)
    }

    /// Posts one step straight to the WKWebView's responder method (the path a real trackpad event takes
    /// after AppKit's hit test). Returns a diagnostic for the first step.
    unsafe fn post_step(webview: *mut c_void, ns_window: *mut c_void, kind: Kind, phase: i64, value: f64, x: f64, y: f64) -> Value {
        let view = webview as *mut AnyObject;
        let window = ns_window as *mut AnyObject;
        if view.is_null() || window.is_null() {
            return json!({ "error": "no web view / window" });
        }
        let in_window = window_point(view, x, y);
        let screen_h = primary_screen_height();
        // Without an on-screen owner AppKit leaves event.window nil and locationInWindow = screen point;
        // place the screen point so that it equals the window point. If AppKit did resolve the window, use
        // the true screen location instead.
        let mut event = match make_event(kind, phase, value, Pt { x: in_window.x, y: screen_h - in_window.y }) {
            Some(e) => e,
            None => return json!({ "error": "eventWithCGEvent returned nil" }),
        };
        let owner: *mut AnyObject = msg_send![event, window];
        let mut mode = "nil-window";
        if !owner.is_null() {
            let screen_pt: Pt = msg_send![window, convertPointToScreen: in_window];
            match make_event(kind, phase, value, Pt { x: screen_pt.x, y: screen_h - screen_pt.y }) {
                Some(e) => event = e,
                None => return json!({ "error": "eventWithCGEvent returned nil" }),
            }
            mode = "resolved-window";
        }
        let ev_type: usize = msg_send![event, type];
        let loc: Pt = msg_send![event, locationInWindow];
        match kind {
            Kind::Scroll => {
                let _: () = msg_send![view, scrollWheel: event];
            }
            Kind::Magnify => {
                if ev_type != 30 {
                    return json!({ "error": format!("synthesised gesture has NSEvent type {ev_type}, not magnify (30)") });
                }
                let _: () = msg_send![view, magnifyWithEvent: event];
            }
        }
        json!({ "mode": mode, "type": ev_type, "locationInWindow": [loc.x, loc.y], "target": [in_window.x, in_window.y] })
    }

    /// Posts native trackpad input to the main web view at `hz` for `duration_ms`: kind "scroll"
    /// (two-finger pan, `delta` px per event, direction flips halfway) or "magnify" (pinch,
    /// `delta` magnification per event, zoom in then out). (x, y) is a CSS point in the web view.
    #[tauri::command]
    pub async fn perf_native_input(
        window: tauri::WebviewWindow,
        kind: String,
        x: f64,
        y: f64,
        duration_ms: u64,
        hz: f64,
        delta: f64,
    ) -> Result<Value, String> {
        let kind = match kind.as_str() {
            "scroll" => Kind::Scroll,
            "magnify" => Kind::Magnify,
            other => return Err(format!("unknown native input kind {other}")),
        };
        let hz = hz.clamp(10.0, 480.0);
        let steps = ((duration_ms as f64 / 1000.0) * hz).round().max(2.0) as u64;
        let period = Duration::from_secs_f64(1.0 / hz);
        let first: Arc<Mutex<Option<Value>>> = Arc::new(Mutex::new(None));
        let started = Instant::now();
        let w = window.clone();
        let first_slot = first.clone();
        let posted = tauri::async_runtime::spawn_blocking(move || {
            let mut posted = 0u64;
            for i in 0..steps {
                let phase = if i == 0 { PHASE_BEGAN } else if i + 1 == steps { PHASE_ENDED } else { PHASE_CHANGED };
                let sign = if i < steps / 2 { 1.0 } else { -1.0 };
                let value = match kind {
                    Kind::Magnify if phase == PHASE_BEGAN => 0.0,
                    _ => delta * sign,
                };
                let slot = first_slot.clone();
                let ok = w
                    .with_webview(move |webview| {
                        let diag = unsafe { post_step(webview.inner(), webview.ns_window(), kind, phase, value, x, y) };
                        if let Ok(mut s) = slot.lock() {
                            if s.is_none() || diag.get("error").is_some() {
                                *s = Some(diag);
                            }
                        }
                    })
                    .is_ok();
                posted += ok as u64;
                // Absolute schedule: no drift from the dispatch cost.
                let next = started + period * (i as u32 + 1);
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                }
            }
            posted
        })
        .await
        .map_err(|e| e.to_string())?;
        let elapsed = started.elapsed().as_secs_f64();
        let diag = first.lock().ok().and_then(|s| s.clone());
        Ok(json!({ "posted": posted, "seconds": elapsed, "rateHz": posted as f64 / elapsed, "diag": diag }))
    }
}

/// `ps` TIME ("[[dd-]hh:]mm:ss.cc") in seconds.
#[cfg_attr(not(feature = "smoke-test"), allow(dead_code))]
fn parse_cpu_time(text: &str) -> Option<f64> {
    let (days, rest) = match text.split_once('-') {
        Some((d, r)) => (d.parse::<f64>().ok()?, r),
        None => (0.0, text),
    };
    let mut secs = 0.0;
    for part in rest.split(':') {
        secs = secs * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(days * 86400.0 + secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ps_cpu_time() {
        assert_eq!(parse_cpu_time("0:01.25"), Some(1.25));
        assert_eq!(parse_cpu_time("1:02:03.50"), Some(3723.5));
        assert_eq!(parse_cpu_time("1-00:00:01.00"), Some(86401.0));
        assert_eq!(parse_cpu_time("x"), None);
    }

    #[test]
    fn related_keys_match_frame_rate_features() {
        assert!(is_related_key(NEAR_60FPS_FEATURE));
        assert!(is_related_key("WebAnimationsCustomFrameRateEnabled"));
        assert!(!is_related_key("AsyncFrameScrollingEnabled"));
    }

    #[test]
    fn status_line_is_loud_unless_cap_is_off() {
        assert!(!status_line(true, true, Some(false), &[]).contains("WARNING"));
        assert!(status_line(false, false, None, &["X60FPSY".into()]).contains("WARNING"));
        assert!(status_line(false, false, None, &["X60FPSY".into()]).contains("X60FPSY"));
        assert!(status_line(true, true, Some(true), &[]).contains("WARNING"));
        assert!(status_line(true, false, None, &[]).contains("WARNING"));
    }
}
