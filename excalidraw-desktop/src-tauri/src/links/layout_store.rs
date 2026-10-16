//! Graph layout persistence: `<state>/graph/<vault-id>/layout.bin`, never inside the vault.
//! The bytes are opaque here; their format belongs to `src/graph/layoutStore.ts`.

use crate::{err, ioerr, write_atomic, Result};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// Largest accepted layout (12 B per node: about 1.3 M nodes).
pub(crate) const MAX_LAYOUT_BYTES: usize = 16 * 1024 * 1024;

/// `<state>/graph/<vault-id>`; the id is a hash, so no input can leave the state dir.
pub(crate) fn graph_dir(state: &Path, root: &Path) -> PathBuf {
    state.join("graph").join(crate::search::vault_id(root))
}

fn layout_file(dir: &Path) -> PathBuf {
    dir.join("layout.bin")
}

/// The saved layout, or empty when there is none (or it is oversize or unreadable).
pub(crate) fn load(dir: &Path) -> Vec<u8> {
    let path = layout_file(dir);
    match fs::metadata(&path) {
        Ok(m) if m.is_file() && m.len() <= MAX_LAYOUT_BYTES as u64 => fs::read(path).unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Atomically replaces the layout; an empty payload deletes it.
pub(crate) fn save(dir: &Path, bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_LAYOUT_BYTES {
        return Err(err("INVALID_FILE", "Graph layout is too large"));
    }
    let path = layout_file(dir);
    if bytes.is_empty() {
        return match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(ioerr(e)),
            _ => Ok(()),
        };
    }
    fs::create_dir_all(dir).map_err(ioerr)?;
    write_atomic(&path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vd-layout-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn round_trip_missing_empty_and_oversize() {
        let state = tmp("rt");
        let dir = graph_dir(&state, Path::new("/some/vault"));
        assert!(load(&dir).is_empty(), "missing file is empty");
        save(&dir, &[1, 2, 3, 4]).unwrap();
        assert_eq!(load(&dir), vec![1, 2, 3, 4]);
        save(&dir, &[9; 100]).unwrap();
        assert_eq!(load(&dir), vec![9; 100], "replaced");
        let leftovers = fs::read_dir(&dir).unwrap().flatten().count();
        assert_eq!(leftovers, 1, "no temp files left");
        let e = save(&dir, &vec![0; MAX_LAYOUT_BYTES + 1]).unwrap_err();
        assert_eq!(e.code, "INVALID_FILE");
        assert_eq!(load(&dir), vec![9; 100], "oversize save leaves the old file");
        save(&dir, &vec![7; MAX_LAYOUT_BYTES]).unwrap();
        assert_eq!(load(&dir).len(), MAX_LAYOUT_BYTES);
        save(&dir, &[]).unwrap();
        assert!(load(&dir).is_empty(), "empty save clears");
        save(&dir, &[]).unwrap();
        let _ = fs::remove_dir_all(&state);
    }

    #[test]
    fn the_path_depends_only_on_a_hash_of_the_vault_root() {
        let state = Path::new("/state");
        for root in ["/v", "/v/../../etc", "../x", "/a/b/../../../..", ""] {
            let dir = graph_dir(state, Path::new(root));
            assert_eq!(dir.parent().unwrap(), state.join("graph"));
            let id = dir.file_name().unwrap().to_str().unwrap();
            assert!(id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit()), "{id}");
        }
    }
}
