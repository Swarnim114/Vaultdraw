//! Content-addressed thumbnail files: `<cache>/<rev[0..2]>/<rev>.png` and `<rev>.v<N>.fail`.
//! Pure functions on paths; validation of every externally supplied name lives here.
use crate::{err, ioerr, Result};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub(super) const MAX_PNG_BYTES: usize = 512 * 1024;
pub(super) const REV_LEN: usize = 64;
pub(super) const VAULT_ID_LEN: usize = 16;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum Kind {
    Png,
    Fail,
}

pub(super) fn parse_kind(value: &str) -> Result<Kind> {
    match value {
        "png" => Ok(Kind::Png),
        "fail" => Ok(Kind::Fail),
        other => Err(err("INVALID_ARGUMENT", format!("Unknown thumbnail kind: {other}"))),
    }
}

/// Lowercase hex of exactly `len` characters (so a name can never contain `/`, `.` or `%`).
pub(super) fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub(super) fn validate_rev(rev: &str) -> Result<()> {
    if is_lower_hex(rev, REV_LEN) {
        Ok(())
    } else {
        Err(err("INVALID_ARGUMENT", "Revision must be 64 lowercase hex characters"))
    }
}

pub(super) fn png_path(cache: &Path, rev: &str) -> PathBuf {
    cache.join(&rev[..2]).join(format!("{rev}.png"))
}

pub(super) fn fail_path(cache: &Path, rev: &str, render_version: u32) -> PathBuf {
    cache.join(&rev[..2]).join(format!("{rev}.v{render_version}.fail"))
}

/// Validate the body for `kind` (PNG magic + size cap, or an empty fail marker).
pub(super) fn validate_body(kind: Kind, body: &[u8]) -> Result<()> {
    match kind {
        Kind::Png => {
            if body.len() > MAX_PNG_BYTES {
                return Err(err("INVALID_FILE", "Thumbnail exceeds 512 KB"));
            }
            crate::clipboard::validate_png(body)
        }
        Kind::Fail if body.is_empty() => Ok(()),
        Kind::Fail => Err(err("INVALID_ARGUMENT", "A fail marker must have an empty body")),
    }
}

static TMP_ID: AtomicU64 = AtomicU64::new(0);

/// Write `bytes` to `dest` through a sibling temp file + rename (never leaves a partial file).
pub(super) fn write_atomic(dest: &Path, bytes: &[u8]) -> Result<()> {
    let dir = dest.parent().ok_or_else(|| err("INTERNAL", "Thumbnail path has no parent"))?;
    fs::create_dir_all(dir).map_err(ioerr)?;
    let tmp = dir.join(format!(".{}-{}.tmp", std::process::id(), TMP_ID.fetch_add(1, Ordering::Relaxed)));
    let res = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        fs::rename(&tmp, dest)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(ioerr(e));
    }
    Ok(())
}

/// Write the file for `kind`; returns its size on disk (0 for fail markers).
pub(super) fn write_entry(cache: &Path, rev: &str, kind: Kind, render_version: u32, body: &[u8]) -> Result<u64> {
    validate_rev(rev)?;
    validate_body(kind, body)?;
    let dest = match kind {
        Kind::Png => png_path(cache, rev),
        Kind::Fail => fail_path(cache, rev, render_version),
    };
    write_atomic(&dest, body)?;
    Ok(body.len() as u64)
}
