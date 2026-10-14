//! Snapshot persistence: `<state>/index/<vault-id>/index.bin`.
//!
//! Layout: magic `VDSI`, u32 format version, u32 normaliser version, u32 crc32 of the
//! payload, then the postcard payload `(saved_at_ms, docs)`. Anything unexpected
//! (missing, corrupt, wrong version, oversize) reads as "no snapshot".

use super::index::{DocEntry, Index};
use super::normalize::NORMALIZER_VERSION;
use crate::{err, ioerr, write_atomic, Result};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::{Path, PathBuf}};

const MAGIC: &[u8; 4] = b"VDSI";
const FORMAT_VERSION: u32 = 1;
const HEADER_LEN: usize = 16;
const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;

/// `<state_dir>/index/<first 16 hex of sha256(root)>/index.bin`.
pub(super) fn snapshot_path(state_dir: &Path, root: &Path) -> PathBuf {
    let id = hex::encode(Sha256::digest(root.to_string_lossy().as_bytes()));
    state_dir.join("index").join(&id[..16]).join("index.bin")
}

pub(super) fn save(path: &Path, saved_at_ms: u64, index: &Index) -> Result<()> {
    let payload = postcard::to_allocvec(&(saved_at_ms, index.docs())).map_err(|e| err("INTERNAL", format!("Index snapshot encode failed: {e}")))?;
    let mut out = Vec::with_capacity(HEADER_LEN + payload.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&NORMALIZER_VERSION.to_le_bytes());
    out.extend_from_slice(&crc32fast::hash(&payload).to_le_bytes());
    out.extend_from_slice(&payload);
    fs::create_dir_all(path.parent().ok_or_else(|| err("INVALID_PATH", "Snapshot has no parent"))?).map_err(ioerr)?;
    write_atomic(path, &out)
}

/// The saved index and the time (ms) it was written.
pub(super) fn load(path: &Path) -> Option<(u64, Index)> {
    if fs::metadata(path).ok()?.len() > MAX_SNAPSHOT_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let header = bytes.get(..HEADER_LEN)?;
    let word = |i: usize| u32::from_le_bytes([header[i], header[i + 1], header[i + 2], header[i + 3]]);
    if &header[..4] != MAGIC || word(4) != FORMAT_VERSION || word(8) != NORMALIZER_VERSION {
        return None;
    }
    let payload = &bytes[HEADER_LEN..];
    if crc32fast::hash(payload) != word(12) {
        return None;
    }
    let (saved_at, docs): (u64, HashMap<String, DocEntry>) = postcard::from_bytes(payload).ok()?;
    Some((saved_at, Index::from_docs(docs)?))
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use crate::search::extract::{ItemKind, TextItem};

    fn sample() -> Index {
        let mut idx = Index::default();
        let items = vec![TextItem { element_id: "a".into(), container_id: Some("c".into()), kind: ItemKind::Frame, text: "Café ☕".into() }];
        idx.upsert("x/a.excalidraw".into(), DocEntry::new("x/a.excalidraw", (10, 20), items));
        idx.upsert("b.excalidraw".into(), DocEntry::name_only("b.excalidraw"));
        idx
    }

    #[test]
    fn roundtrip_preserves_entries_and_rebuilds_derived_fields() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("i/index.bin");
        save(&file, 123, &sample()).unwrap();
        let (at, idx) = load(&file).unwrap();
        assert_eq!(at, 123);
        assert_eq!(idx.counts(), (1, 2));
        assert_eq!(idx.get("x/a.excalidraw").unwrap().stat, (10, 20));
        let (hits, _) = idx.query("cafe", crate::search::types::Scope::All, 5);
        assert_eq!(hits[0].matches[0].container_id.as_deref(), Some("c"));
    }

    #[test]
    fn missing_corrupt_truncated_and_mismatched_files_load_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("index.bin");
        assert!(load(&file).is_none());
        save(&file, 1, &sample()).unwrap();
        let good = fs::read(&file).unwrap();
        // flipped payload byte
        let mut bad = good.clone();
        *bad.last_mut().unwrap() ^= 0xFF;
        fs::write(&file, &bad).unwrap();
        assert!(load(&file).is_none());
        // truncated
        fs::write(&file, &good[..good.len() - 3]).unwrap();
        assert!(load(&file).is_none());
        fs::write(&file, &good[..8]).unwrap();
        assert!(load(&file).is_none());
        // wrong magic / format / normaliser version
        for (off, byte) in [(0, b'X'), (4, 9), (8, 9)] {
            let mut bad = good.clone();
            bad[off] = byte;
            fs::write(&file, &bad).unwrap();
            assert!(load(&file).is_none(), "offset {off}");
        }
        fs::write(&file, &good).unwrap();
        assert!(load(&file).is_some());
    }

    #[test]
    fn snapshot_path_is_stable_and_per_vault() {
        let a = snapshot_path(Path::new("/s"), Path::new("/v/one"));
        assert_eq!(a, snapshot_path(Path::new("/s"), Path::new("/v/one")));
        assert_ne!(a, snapshot_path(Path::new("/s"), Path::new("/v/two")));
        assert!(a.starts_with("/s/index") && a.ends_with("index.bin"));
        assert_eq!(a.parent().unwrap().file_name().unwrap().len(), 16);
    }
}
