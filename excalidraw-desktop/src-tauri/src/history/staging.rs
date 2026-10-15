//! Staged clones: the only history code on the save path is `stage_after_commit` (one
//! `clonefile` of the freshly committed drawing into `<state>/history/<vault-id>/staged/`).
//! The staged set is small by construction: pending commits (committed, not yet versioned) plus
//! one open-time clone per open editor; a clone is deleted as soon as its state is versioned.
//!
//! File names: `<key>.<rev16>.excalidraw` (pending), `o-<key>.<rev16>.excalidraw` (open-time),
//! `<key>.path` (sidecar naming the drawing, so a crash-survivor clone can be attributed).
//! `<key>` = 16 hex of an FNV-1a hash of the (case-folded) vault-relative path.

use super::store;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::SystemTime,
};

/// Lock-free switches read on the save path (the worker and commands write them).
#[derive(Default)]
pub struct Flags {
    pub configured: AtomicBool,
    pub enabled: AtomicBool,
    pub read_only: AtomicBool,
    pub disk_low: AtomicBool,
    /// `false` after the first `ENOTSUP`/`EXDEV` from `clonefile` (non-APFS or another volume).
    pub staging_unsupported: AtomicBool,
    pub fold: AtomicBool,
    /// Set once by `start` (a worker exists that will consume `Committed`).
    pub active: AtomicBool,
}

impl Flags {
    #[inline]
    pub fn history_on(&self) -> bool {
        self.active.load(Ordering::Relaxed) && self.configured.load(Ordering::Relaxed) && self.enabled.load(Ordering::Relaxed) && !self.read_only.load(Ordering::Relaxed)
    }
    #[inline]
    pub fn should_stage(&self) -> bool {
        self.history_on() && !self.staging_unsupported.load(Ordering::Relaxed) && !self.disk_low.load(Ordering::Relaxed)
    }
    pub fn staging_supported(&self) -> bool {
        !self.staging_unsupported.load(Ordering::Relaxed)
    }
}

pub fn key_for(rel: &str, fold: bool) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |b: u8| {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    };
    if fold {
        rel.to_lowercase().bytes().for_each(&mut feed);
    } else {
        rel.bytes().for_each(&mut feed);
    }
    format!("{h:016x}")
}

pub fn rev16(revision: &str) -> Option<&str> {
    revision.get(..16).filter(|r| r.bytes().all(|b| b.is_ascii_hexdigit()))
}

pub fn clone_name(key: &str, rev16: &str) -> String {
    format!("{key}.{rev16}.excalidraw")
}

pub fn open_clone_name(key: &str, rev16: &str) -> String {
    format!("o-{key}.{rev16}.excalidraw")
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloneName {
    pub key: String,
    pub rev16: String,
    pub open: bool,
}

fn hex16(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn parse_clone_name(file: &str) -> Option<CloneName> {
    let stem = file.strip_suffix(".excalidraw")?;
    let (open, stem) = match stem.strip_prefix("o-") {
        Some(s) => (true, s),
        None => (false, stem),
    };
    let (key, rev) = stem.split_once('.')?;
    (hex16(key) && hex16(rev)).then(|| CloneName { key: key.into(), rev16: rev.into(), open })
}

/// The save-path hook: clone the committed file under its own per-revision name. Never fails the
/// save: errors only flip flags (`staging_unsupported`, `disk_low`).
pub fn stage_after_commit(flags: &Flags, staged_dir: &Path, root: &Path, rel: &str, revision: &str) -> Option<PathBuf> {
    if !flags.should_stage() {
        return None;
    }
    let rev = rev16(revision)?;
    let key = key_for(rel, flags.fold.load(Ordering::Relaxed));
    let dst = staged_dir.join(clone_name(&key, rev));
    match store::clone_file(&root.join(rel), &dst) {
        Ok(()) => Some(dst),
        // The same content was committed again while its clone still exists.
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Some(dst),
        Err(e) => {
            if store::clone_unsupported(&e) {
                flags.staging_unsupported.store(true, Ordering::Relaxed);
            } else if store::is_enospc(&e) {
                flags.disk_low.store(true, Ordering::Relaxed);
            }
            None
        }
    }
}

/// Clones the drawing's state at open time (replacing an older open-time clone of the same drawing).
pub fn clone_open(flags: &Flags, staged_dir: &Path, root: &Path, rel: &str, revision: &str) -> Option<PathBuf> {
    if !flags.should_stage() {
        return None;
    }
    let rev = rev16(revision)?;
    // Same symlink / escape checks as every other vault access (never clone through a link).
    let src = crate::safe_path(root, rel, false).ok()?;
    let key = key_for(rel, flags.fold.load(Ordering::Relaxed));
    remove_open_clones(staged_dir, &key);
    let dst = staged_dir.join(open_clone_name(&key, rev));
    match store::clone_file(&src, &dst) {
        Ok(()) => Some(dst),
        Err(e) => {
            if store::clone_unsupported(&e) {
                flags.staging_unsupported.store(true, Ordering::Relaxed);
            }
            None
        }
    }
}

pub fn remove_open_clones(staged_dir: &Path, key: &str) {
    for c in list_clones(staged_dir).into_iter().filter(|c| c.name.open && c.name.key == key) {
        let _ = fs::remove_file(c.path);
    }
}

/// Records which drawing a key stands for (read back by startup catch-up).
pub fn write_sidecar(staged_dir: &Path, key: &str, rel: &str) {
    let p = staged_dir.join(format!("{key}.path"));
    if fs::read_to_string(&p).is_ok_and(|s| s == rel) {
        return;
    }
    let _ = fs::write(p, rel);
}

pub fn read_sidecar(staged_dir: &Path, key: &str) -> Option<String> {
    let s = store::read_capped(&staged_dir.join(format!("{key}.path")), 8192).ok()?;
    let s = String::from_utf8(s).ok()?;
    crate::validate_relative(&s).ok().filter(|p| !p.is_empty())?;
    Some(s)
}

#[derive(Clone, Debug)]
pub struct StagedFile {
    pub name: CloneName,
    pub path: PathBuf,
    pub size: u64,
    pub mtime: SystemTime,
}

pub fn list_clones(staged_dir: &Path) -> Vec<StagedFile> {
    let Ok(rd) = fs::read_dir(staged_dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let name = parse_clone_name(e.file_name().to_str()?)?;
            let md = e.metadata().ok().filter(|m| m.is_file())?;
            Some(StagedFile { name, path: e.path(), size: md.len(), mtime: md.modified().unwrap_or(SystemTime::UNIX_EPOCH) })
        })
        .collect()
}

pub fn remove_clone(path: &Path) {
    let _ = fs::remove_file(path);
}

/// Deletes every file in the staged dir except the sidecars of keys in `keep` (disk-low drop and
/// shutdown of a disabled history).
pub fn drop_clones(staged_dir: &Path, keep: &dyn Fn(&StagedFile) -> bool) {
    for c in list_clones(staged_dir) {
        if !keep(&c) {
            remove_clone(&c.path);
        }
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn keys_are_stable_fold_aware_and_names_roundtrip() {
        assert_eq!(key_for("A/b.excalidraw", false), key_for("A/b.excalidraw", false));
        assert_ne!(key_for("A/b.excalidraw", false), key_for("a/b.excalidraw", false));
        assert_eq!(key_for("A/b.excalidraw", true), key_for("a/B.excalidraw", true));
        let k = key_for("x.excalidraw", false);
        let n = clone_name(&k, "0123456789abcdef");
        assert_eq!(parse_clone_name(&n), Some(CloneName { key: k.clone(), rev16: "0123456789abcdef".into(), open: false }));
        assert!(parse_clone_name(&open_clone_name(&k, "0123456789abcdef")).unwrap().open);
        assert!(parse_clone_name("x.excalidraw").is_none());
        assert!(parse_clone_name(&format!("{k}.path")).is_none());
        assert!(rev16("zz").is_none());
    }

    #[test]
    fn nothing_is_staged_unless_fully_on() {
        let flags = Flags::default();
        let d = tempfile::tempdir().unwrap();
        assert!(stage_after_commit(&flags, d.path(), d.path(), "a.excalidraw", &"a".repeat(64)).is_none());
        assert!(!flags.history_on());
        flags.active.store(true, Ordering::Relaxed);
        flags.enabled.store(true, Ordering::Relaxed);
        assert!(!flags.history_on(), "unconfigured = off");
        flags.configured.store(true, Ordering::Relaxed);
        assert!(flags.should_stage());
        flags.read_only.store(true, Ordering::Relaxed);
        assert!(!flags.should_stage());
        flags.read_only.store(false, Ordering::Relaxed);
        flags.disk_low.store(true, Ordering::Relaxed);
        assert!(!flags.should_stage());
    }
}
