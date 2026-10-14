//! Native clipboard export (`copy_to_clipboard`) and shared raw-IPC helpers.
//! Platform code is thin; validation and header parsing are pure and unit tested.
#![cfg_attr(test, allow(dead_code))]
use crate::{err, Result};
use tauri::ipc::{InvokeBody, Request};

/// Upper bound for raw export / clipboard payloads.
pub const MAX_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Kind {
    Png,
    Svg,
}

pub fn parse_kind(value: &str) -> Result<Kind> {
    match value {
        "png" => Ok(Kind::Png),
        "svg" => Ok(Kind::Svg),
        other => Err(err("INVALID_ARGUMENT", format!("Unknown clipboard kind: {other}"))),
    }
}

/// Decode `%XX` escapes (as produced by `encodeURIComponent`) into a UTF-8 string.
pub fn percent_decode(input: &str) -> Result<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok());
            let byte = hex
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| err("INVALID_ARGUMENT", "Malformed percent-encoding in header"))?;
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| err("INVALID_ARGUMENT", "Header is not valid UTF-8"))
}

/// Return the raw binary body, rejecting JSON bodies and oversized payloads.
pub fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => check_size(bytes),
        InvokeBody::Json(_) => Err(err("INVALID_ARGUMENT", "Expected a raw binary body, got JSON")),
    }
}

pub fn check_size(bytes: &[u8]) -> Result<&[u8]> {
    if bytes.is_empty() {
        return Err(err("INVALID_ARGUMENT", "Empty payload"));
    }
    if bytes.len() > MAX_PAYLOAD_BYTES {
        return Err(err("INVALID_FILE", "Payload exceeds 64 MiB"));
    }
    Ok(bytes)
}

pub fn header(request: &Request<'_>, name: &str) -> Result<String> {
    header_value(request.headers(), name)
}

pub fn header_value(headers: &tauri::http::HeaderMap, name: &str) -> Result<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| err("INVALID_ARGUMENT", format!("Missing header {name}")))
}

pub fn validate_png(bytes: &[u8]) -> Result<()> {
    if bytes.len() > PNG_SIGNATURE.len() && bytes.starts_with(&PNG_SIGNATURE) {
        Ok(())
    } else {
        Err(err("INVALID_ARGUMENT", "Payload is not a PNG image"))
    }
}

/// Validate UTF-8 and that the document contains an `<svg` root; returns the text.
pub fn validate_svg(bytes: &[u8]) -> Result<&str> {
    let text = std::str::from_utf8(bytes).map_err(|_| err("INVALID_ARGUMENT", "SVG is not valid UTF-8"))?;
    if text.contains("<svg") {
        Ok(text)
    } else {
        Err(err("INVALID_ARGUMENT", "Payload is not an SVG document"))
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSData, NSString};
    use tauri::AppHandle;

    /// Run `f` on the main thread and wait for its result.
    pub fn on_main<T: Send + 'static>(
        app: &AppHandle,
        f: impl FnOnce() -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(f());
        })
        .map_err(|e| err("IO_ERROR", e.to_string()))?;
        rx.recv().map_err(|_| err("IO_ERROR", "Clipboard task did not complete"))?
    }

    pub fn write(app: &AppHandle, kind: Kind, bytes: Vec<u8>) -> Result<()> {
        on_main(app, move || {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            let set_data = |data: &[u8], ty: &str| -> Result<()> {
                let ok = pb.setData_forType(Some(&NSData::with_bytes(data)), &NSString::from_str(ty));
                if ok { Ok(()) } else { Err(err("IO_ERROR", format!("Pasteboard rejected {ty}"))) }
            };
            match kind {
                Kind::Png => set_data(&bytes, "public.png"),
                Kind::Svg => {
                    let text = validate_svg(&bytes)?;
                    set_data(&bytes, "public.svg-image")?;
                    let ok = pb.setString_forType(&NSString::from_str(text), &NSString::from_str("public.utf8-plain-text"));
                    if ok { Ok(()) } else { Err(err("IO_ERROR", "Pasteboard rejected text")) }
                }
            }
        })
    }

    #[cfg(feature = "smoke-test")]
    pub fn read(app: &AppHandle) -> Result<serde_json::Value> {
        on_main(app, || {
            let pb = NSPasteboard::generalPasteboard();
            let types: Vec<String> = pb
                .types()
                .map(|t| t.iter().map(|s| s.to_string()).collect())
                .unwrap_or_default();
            let png = pb.dataForType(&NSString::from_str("public.png")).map(|d| d.len());
            let svg = pb
                .dataForType(&NSString::from_str("public.svg-image"))
                .and_then(|d| String::from_utf8(d.to_vec()).ok())
                .or_else(|| pb.stringForType(&NSString::from_str("public.utf8-plain-text")).map(|s| s.to_string()));
            Ok(serde_json::json!({ "types": types, "pngBytes": png, "svgText": svg }))
        })
    }
}

fn validate(kind: Kind, bytes: &[u8]) -> Result<()> {
    match kind {
        Kind::Png => validate_png(bytes),
        Kind::Svg => validate_svg(bytes).map(|_| ()),
    }
}

#[tauri::command]
pub async fn copy_to_clipboard(app: tauri::AppHandle, request: Request<'_>) -> Result<()> {
    let kind = parse_kind(&header(&request, "x-clipboard-kind")?)?;
    let bytes = raw_body(&request)?;
    validate(kind, bytes)?;
    write_native(&app, kind, bytes)
}

#[cfg(target_os = "macos")]
fn write_native(app: &tauri::AppHandle, kind: Kind, bytes: &[u8]) -> Result<()> {
    mac::write(app, kind, bytes.to_vec())
}

#[cfg(not(target_os = "macos"))]
fn write_native(_app: &tauri::AppHandle, _kind: Kind, _bytes: &[u8]) -> Result<()> {
    Err(unsupported())
}

#[cfg(not(target_os = "macos"))]
fn unsupported() -> crate::NativeError {
    err("UNSUPPORTED", "Native clipboard is only available on macOS")
}

#[cfg(feature = "smoke-test")]
#[tauri::command]
pub async fn smoke_read_clipboard(app: tauri::AppHandle) -> Result<serde_json::Value> {
    #[cfg(target_os = "macos")]
    { mac::read(&app) }
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Err::<serde_json::Value, crate::NativeError>(unsupported()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_parsing() {
        assert_eq!(parse_kind("png").unwrap(), Kind::Png);
        assert_eq!(parse_kind("svg").unwrap(), Kind::Svg);
        assert!(parse_kind("PNG").is_err());
        assert!(parse_kind("").is_err());
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("a%20b.png").unwrap(), "a b.png");
        assert_eq!(percent_decode("%E2%9C%93.svg").unwrap(), "\u{2713}.svg");
        assert_eq!(percent_decode("plain").unwrap(), "plain");
        assert_eq!(percent_decode("..%2Fevil").unwrap(), "../evil");
        assert!(percent_decode("bad%2").is_err());
        assert!(percent_decode("bad%zz").is_err());
        assert!(percent_decode("%FF%FE").is_err());
    }

    #[test]
    fn png_signature() {
        let mut png = PNG_SIGNATURE.to_vec();
        png.extend_from_slice(b"rest");
        assert!(validate_png(&png).is_ok());
        assert!(validate_png(&PNG_SIGNATURE).is_err());
        assert!(validate_png(b"<svg/>").is_err());
    }

    #[test]
    fn svg_validation() {
        assert_eq!(validate_svg(b"<?xml?><svg></svg>").unwrap(), "<?xml?><svg></svg>");
        assert!(validate_svg(b"hello").is_err());
        assert!(validate_svg(&[0xFF, 0xFE, b'<', b's', b'v', b'g']).is_err());
    }

    #[test]
    fn size_cap() {
        assert!(check_size(&[]).is_err());
        assert!(check_size(&[1]).is_ok());
        assert!(check_size(&vec![0u8; MAX_PAYLOAD_BYTES + 1]).is_err());
        assert!(check_size(&vec![0u8; MAX_PAYLOAD_BYTES]).is_ok());
    }
}
