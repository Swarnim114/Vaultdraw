//! `vdthumb://localhost/<vaultId 16hex>/<rev 64hex>.png`. Hex-only validation makes traversal
//! impossible by construction (no `/`, `.` or `%` can survive), and no directory is ever listed.
use super::store::{is_lower_hex, png_path, REV_LEN, VAULT_ID_LEN};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// `(vault_id, rev)` from a URL path like `/<vaultId>/<rev>.png`, or None.
pub(super) fn parse(uri_path: &str) -> Option<(&str, &str)> {
    let rest = uri_path.strip_prefix('/')?;
    let (vault_id, file) = rest.split_once('/')?;
    let rev = file.strip_suffix(".png")?;
    (is_lower_hex(vault_id, VAULT_ID_LEN) && is_lower_hex(rev, REV_LEN)).then_some((vault_id, rev))
}

/// Cache file for a URL path, or None when the path is not a valid thumbnail URL.
pub(super) fn resolve(state_dir: &Path, uri_path: &str) -> Option<PathBuf> {
    let (vault_id, rev) = parse(uri_path)?;
    Some(png_path(&super::cache_dir(state_dir, vault_id), rev))
}

/// PNG bytes for a URL path; None means 404.
pub(super) fn read(state_dir: &Path, uri_path: &str) -> Option<Vec<u8>> {
    fs::read(resolve(state_dir, uri_path)?).ok()
}

/// 200 image/png (immutable: the name is the content hash) or an empty 404.
pub(super) fn response(png: Option<Vec<u8>>) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    let builder = tauri::http::Response::builder();
    match png {
        Some(bytes) => builder
            .status(200)
            .header("Content-Type", "image/png")
            .header("Cache-Control", "public, max-age=31536000, immutable")
            .body(std::borrow::Cow::Owned(bytes)),
        None => builder.status(404).body(std::borrow::Cow::Borrowed(&[][..])),
    }
    .expect("static response parts are valid")
}
