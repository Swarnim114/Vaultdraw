//! The version-write pipeline: read the state (clone or live file), skip unchanged content, strip
//! images into own blobs, choose keyframe or proven delta (rotation rules, PLAN §2.3), write
//! `.<final>.tmp` → fsync → rename, update the index. Runs on the worker thread only.
//!
//! `Backend` is the seam the worker's trigger logic is tested through (fake in tests).

use super::{
    codec::{self, BlobMemo},
    container::{self, Header},
    index::{self, Entry, Head, Index},
    names::{self, BlobName, NameKind, Reason, UlidGen, VersionName},
    staging,
    store::{self, Store},
};
use crate::{err, ioerr, safe_path, Result};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

const WEEK_MS: u64 = 7 * 24 * 3600 * 1000;
pub const MAX_DELTAS: usize = 50;
const MEMO_CAP: usize = 4096;

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}
pub struct SystemClock;
impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        crate::now_ms(std::time::SystemTime::now())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    /// A staged clone file (pending commit or open-time clone).
    Clone(PathBuf),
    /// The live file in the vault (revision-checked).
    Live,
}

#[derive(Clone, Debug)]
pub struct VersionRequest {
    pub path: String,
    pub reason: Reason,
    pub name: Option<String>,
    pub note: Option<String>,
    pub source: Source,
    /// The revision the state must have (commit revision, or the revision `history_opened` named).
    pub revision: Option<String>,
    /// Committed size of a pending clone (the cheap identity check).
    pub size: Option<u64>,
    /// Hash the source and compare with `revision` (open-time clones, live reads).
    pub verify: bool,
    /// Checkpoints are written even when the content equals the newest version.
    pub allow_unchanged: bool,
    /// Startup catch-up: the state's revision must start with this (clone name check).
    pub rev_prefix: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Written {
    pub id: String,
    pub lineage: String,
    pub revision: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Written(Written),
    /// "unchanged" | "changed" | "missing" | "stopped"
    Skipped(&'static str),
    /// Free space below the floor (or ENOSPC): nothing was written.
    DiskLow,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Latest {
    pub revision: String,
    pub created_ms: u64,
}

/// Everything the worker's trigger logic needs from the outside world.
pub trait Backend {
    /// Newest version of `path` across lineages (header loaded if needed).
    fn latest(&mut self, path: &str) -> Option<Latest>;
    fn write(&mut self, req: &VersionRequest) -> Result<Outcome>;
    fn remove_clone(&mut self, file: &Path);
    /// Size of a staged clone without `isDeleted` tombstones (shrink rule); `raw` when unknown.
    fn live_size(&mut self, file: &Path, raw: u64) -> u64;
    /// Records which drawing a staged key stands for (so a crash-survivor clone can be attributed).
    fn note_path(&mut self, path: &str);
    /// Free space fell below the floor: raise the flag, drop clones that are not `keep`.
    fn disk_low(&mut self, keep: &HashSet<PathBuf>);
    /// Free space recovered.
    fn disk_ok(&mut self);
    fn error(&mut self, code: &str, message: &str);
    /// A version appeared for `path` (the service debounces `history-change`).
    fn changed(&mut self, path: &str, lineage: &str);
    /// A drawing moved (H3): rename its staged clone to the new path's key and repoint the sidecar.
    /// `None` = not renamed (fakes, non-staged).
    fn rename_clone(&mut self, _file: &Path, _old: &str, _new: &str) -> Option<PathBuf> {
        None
    }
    /// After a move: drop the old path's sidecar when no clone uses its key anymore.
    fn drop_sidecar(&mut self, _old: &str, _new: &str) {}
}

struct Memo(HashMap<(String, usize, u32), String>);
impl BlobMemo for Memo {
    fn lookup(&self, file_id: &str, payload_len: usize, crc: u32) -> Option<String> {
        self.0.get(&(file_id.to_string(), payload_len, crc)).cloned()
    }
    fn remember(&mut self, file_id: &str, payload_len: usize, crc: u32, sha_ext: &str) {
        if self.0.len() >= MEMO_CAP {
            self.0.clear();
        }
        self.0.insert((file_id.to_string(), payload_len, crc), sha_ext.to_string());
    }
}

/// This device's blob epoch (B1/M8): rotates when its previous history write is > 7 days old.
pub struct Epoch {
    pub code: String,
    last_write_ms: u64,
    persisted_ms: u64,
    file: Option<PathBuf>,
}

impl Epoch {
    pub fn load(file: Option<PathBuf>, now_ms: u64) -> Epoch {
        let saved = file.as_ref().and_then(|f| fs::read_to_string(f).ok()).and_then(|s| {
            let (code, ms) = s.trim().split_once(' ')?;
            let ms = ms.parse::<u64>().ok()?;
            names::is_epoch(code).then(|| (code.to_string(), ms))
        });
        let (code, last) = match saved {
            Some((c, l)) if now_ms.saturating_sub(l) <= WEEK_MS => (c, l),
            _ => (names::epoch_code(names::day_number(now_ms)), 0),
        };
        let mut e = Epoch { code, last_write_ms: last, persisted_ms: 0, file };
        e.persist(now_ms, true);
        e
    }
    /// Called before a write: starts a new epoch when the previous write is more than 7 days old.
    pub fn current(&mut self, now_ms: u64) -> &str {
        if self.last_write_ms != 0 && now_ms.saturating_sub(self.last_write_ms) > WEEK_MS {
            self.code = names::epoch_code(names::day_number(now_ms));
            self.persist(now_ms, true);
        }
        &self.code
    }
    pub fn wrote(&mut self, now_ms: u64) {
        self.last_write_ms = now_ms;
        self.persist(now_ms, false);
    }
    /// At most once an hour (the 7-day rule doesn't need finer state).
    fn persist(&mut self, now_ms: u64, force: bool) {
        if !force && now_ms.saturating_sub(self.persisted_ms) < 3_600_000 {
            return;
        }
        if let Some(f) = &self.file {
            // The last real write, not "now": starting the app must not postpone the 7-day rotation.
            let last = if self.last_write_ms == 0 { now_ms } else { self.last_write_ms };
            let _ = fs::write(f, format!("{} {}", self.code, last));
            self.persisted_ms = now_ms;
        }
    }
}

pub struct Writer {
    pub store: Store,
    pub index: Arc<RwLock<Index>>,
    pub dev: String,
    pub ulid: UlidGen,
    pub epoch: Epoch,
    pub clock: Arc<dyn Clock>,
    /// Free space above the floor? (injected in tests)
    pub free_ok: Box<dyn Fn() -> bool + Send>,
    /// Generation token: false once a newer worker owns this vault id.
    pub is_current: Box<dyn Fn() -> bool + Send>,
    memo: Memo,
    confirmed: HashSet<String>,
    layout_ok: bool,
    /// Lineages that got a version since the last `take_written` (the worker runs retention on them).
    written: Vec<String>,
}

impl Writer {
    pub fn new(store: Store, index: Arc<RwLock<Index>>, dev: String, ulid: UlidGen, epoch: Epoch, clock: Arc<dyn Clock>, free_ok: Box<dyn Fn() -> bool + Send>, is_current: Box<dyn Fn() -> bool + Send>) -> Writer {
        Writer { store, index, dev, ulid, epoch, clock, free_ok, is_current, memo: Memo(HashMap::new()), confirmed: HashSet::new(), layout_ok: false, written: Vec::new() }
    }

    /// Lineages written to since the last call (deduplicated, bounded).
    pub fn take_written(&mut self) -> Vec<String> {
        let mut w = std::mem::take(&mut self.written);
        w.sort();
        w.dedup();
        w
    }

    pub fn latest_of(&self, path: &str) -> Option<Latest> {
        let id = {
            let g = self.index.read().unwrap_or_else(|p| p.into_inner());
            g.latest_for_path(path).map(|(_, e)| e.name.id.clone())?
        };
        index::ensure_head(&self.store, &self.index, &id);
        let g = self.index.read().unwrap_or_else(|p| p.into_inner());
        let (_, e) = g.entry(&id)?;
        Some(Latest { revision: e.head.as_ref()?.rev.clone(), created_ms: e.name.time_ms() })
    }

    /// (bytes, revision) of the requested state, or why it isn't available.
    fn read_source(&self, req: &VersionRequest) -> std::result::Result<(Vec<u8>, String), &'static str> {
        let expected = req.revision.as_deref();
        if let Source::Clone(p) = &req.source {
            if let Ok(bytes) = store::read_capped(p, crate::MAX_DRAWING_BYTES) {
                if req.size.is_none_or(|s| s == bytes.len() as u64) {
                    match (expected, req.verify) {
                        (Some(r), false) => return Ok((bytes, r.to_string())),
                        _ => {
                            let rev = hex::encode(Sha256::digest(&bytes));
                            if expected.is_none_or(|r| r == rev) && req.rev_prefix.as_deref().is_none_or(|p| rev.starts_with(p)) {
                                return Ok((bytes, rev));
                            }
                        }
                    }
                }
            }
            // The clone is gone or isn't the committed state: fall back to the live file below
            // (only when a revision names the state we want).
            expected.ok_or("missing")?;
        }
        let abs = safe_path(&self.store.root, &req.path, false).map_err(|_| "missing")?;
        let bytes = store::read_capped(&abs, crate::MAX_DRAWING_BYTES).map_err(|_| "missing")?;
        let rev = hex::encode(Sha256::digest(&bytes));
        if expected.is_some_and(|r| r != rev) {
            return Err("changed");
        }
        Ok((bytes, rev))
    }

    fn own_blob(&self, sha_ext: &str, epoch: &str) -> Option<BlobName> {
        let (sha, ext) = sha_ext.split_once('.')?;
        Some(BlobName { sha: sha.to_string(), dev: self.dev.clone(), epoch: epoch.to_string(), ext: ext.to_string() })
    }

    /// This device's newest usable keyframe of `lineage` (rotation rules: not a checkpoint, ≤ 7 days
    /// old, stat-confirmed this session, fewer than 50 deltas on it).
    fn pick_keyframe(&mut self, lineage: &str, now: u64) -> Option<(VersionName, u64)> {
        let (name, size) = {
            let g = self.index.read().unwrap_or_else(|p| p.into_inner());
            let l = g.lineages.get(lineage)?;
            let kf = l.versions.values().rev().find(|e| e.name.dev == self.dev && e.name.is_keyframe() && e.reason() != Reason::Checkpoint)?;
            if now.saturating_sub(kf.name.time_ms()) > WEEK_MS {
                return None;
            }
            let deltas = l.versions.values().filter(|e| e.keyframe_id() == Some(kf.name.id.as_str())).count();
            if deltas >= MAX_DELTAS {
                return None;
            }
            (kf.name.clone(), kf.size)
        };
        if !self.confirmed.contains(&name.id) {
            if !fs::symlink_metadata(self.store.version_path(lineage, &name)).is_ok_and(|m| m.is_file()) {
                return None;
            }
            self.confirmed.insert(name.id.clone());
        }
        Some((name, size))
    }

    /// Keyframe stripped text, checked against its header's `strippedHash`.
    fn keyframe_text(&self, lineage: &str, name: &VersionName) -> Option<Vec<u8>> {
        let file = self.store.read_version_file(lineage, name).ok()?;
        let header = container::read_header(&file).ok()?;
        let body = container::read_body(&file, store::MAX_BODY_BYTES as usize).ok()?;
        (hex::encode(Sha256::digest(&body)) == header.stripped_hash).then_some(body)
    }

    pub fn write_version(&mut self, req: &VersionRequest) -> Result<Outcome> {
        if !(self.is_current)() {
            return Ok(Outcome::Skipped("stopped"));
        }
        if !(self.free_ok)() {
            return Ok(Outcome::DiskLow);
        }
        let (bytes, revision) = match self.read_source(req) {
            Ok(v) => v,
            Err(why) => return Ok(Outcome::Skipped(why)),
        };
        if !req.allow_unchanged && self.latest_of(&req.path).is_some_and(|l| l.revision == revision) {
            return Ok(Outcome::Skipped("unchanged"));
        }
        if !self.layout_ok {
            self.store.ensure_layout()?;
            self.layout_ok = true;
        }
        let now = self.clock.now_ms();
        let full = req.reason.needs_full_sync();
        let epoch = self.epoch.current(now).to_string();
        let existing = self.index.read().unwrap_or_else(|p| p.into_inner()).lineage_for_write(&req.path, &self.dev);
        let dev = self.dev.clone();
        let store = self.store.clone();
        let own_epoch = epoch.clone();
        let own_exists = move |sha_ext: &str| -> bool {
            sha_ext.split_once('.').is_some_and(|(sha, ext)| store.blob_exists(&BlobName { sha: sha.into(), dev: dev.clone(), epoch: own_epoch.clone(), ext: ext.into() }))
        };
        let stripped = codec::strip(&bytes, &mut self.memo, &own_exists, &self.dev, &epoch)?;
        let source_len = bytes.len() as u64;
        drop(bytes);
        // 1. own blobs first (dependencies are durable before the referencing file appears)
        for b in &stripped.new_blobs {
            let Some(name) = BlobName::parse(&b.file) else { return Err(err("INTERNAL", "Codec produced an invalid blob name")) };
            if !self.guard(self.store.write_blob(&name, &b.bytes, full))? {
                return Ok(Outcome::DiskLow);
            }
        }
        // 2. keyframe or proven delta
        let lineage = existing.clone().unwrap_or_else(|| self.ulid.next(now));
        let id = self.ulid.next(now);
        let stripped_hash = hex::encode(Sha256::digest(&stripped.text));
        let mut header = Header {
            format: 1,
            kind: "keyframe".into(),
            id: id.clone(),
            lineage: lineage.clone(),
            device: self.dev.clone(),
            epoch: epoch.clone(),
            created: now,
            reason: req.reason.as_str().into(),
            name: req.name.clone(),
            note: req.note.clone(),
            path: req.path.clone(),
            file_revision: revision.clone(),
            stripped_hash,
            file_size: 0,
            element_count: stripped.element_count,
            keyframe: None,
            blobs: stripped.blobs.clone(),
            app: format!("vaultdraw {}", env!("CARGO_PKG_VERSION")),
        };
        header.file_size = req.size.unwrap_or(source_len);
        let mut kind = NameKind::Keyframe(req.reason);
        let mut container_bytes: Option<(Vec<u8>, Vec<u8>)> = None;
        if existing.is_some() {
            if let Some((kname, ksize)) = self.pick_keyframe(&lineage, now) {
                if let Some(ktext) = self.keyframe_text(&lineage, &kname) {
                    if let Some(delta) = codec::proven_delta(&ktext, &stripped.text) {
                        let mut dh = header.clone();
                        dh.kind = "delta".into();
                        dh.keyframe = Some(kname.id.clone());
                        let c = container::write_container(&dh, &delta, container::ZSTD_LEVEL);
                        // A delta that isn't clearly smaller than its keyframe starts a new keyframe.
                        if !codec::delta_too_big(c.len(), ksize as usize) {
                            header = dh;
                            kind = NameKind::Delta(req.reason, kname.id);
                            container_bytes = Some((c, delta));
                        }
                    }
                }
            }
        }
        let (container_bytes, delta_body) = match container_bytes {
            Some((c, d)) => (c, Some(d)),
            None => (container::write_container(&header, &stripped.text, container::ZSTD_LEVEL), None),
        };
        let body: &[u8] = delta_body.as_deref().unwrap_or(&stripped.text);
        // write_container can't fail by signature (an allocation failure yields an empty frame):
        // prove the bytes decode to what we meant to store before they become visible.
        if container::read_header(&container_bytes).map(|h| h.id != id).unwrap_or(true) || container::read_body(&container_bytes, codec::MAX_TEXT_BYTES).map_or(true, |b| b != body) {
            return Err(err("INTERNAL", "History encoder produced an unreadable version"));
        }
        let vname = VersionName { id: id.clone(), dev: self.dev.clone(), kind };
        if !(self.is_current)() {
            return Ok(Outcome::Skipped("stopped"));
        }
        if !self.guard(self.store.write_version(&lineage, &vname, &container_bytes, full))? {
            return Ok(Outcome::DiskLow);
        }
        let size = container_bytes.len() as u64;
        let head = Head { path: header.path.clone(), name: header.name.clone(), note: header.note.clone(), rev: revision.clone(), element_count: header.element_count, blobs: header.blobs.clone() };
        if vname.is_keyframe() {
            self.confirmed.insert(id.clone());
        }
        self.index.write().unwrap_or_else(|p| p.into_inner()).insert(&lineage, Entry { name: vname, size, dataless: false, head: Some(head) }, now);
        self.epoch.wrote(now);
        if self.written.len() < 4096 {
            self.written.push(lineage.clone());
        }
        if size > 1024 * 1024 || stripped.text.len() > 4 * 1024 * 1024 {
            crate::memory::schedule_release();
        }
        Ok(Outcome::Written(Written { id, lineage, revision, bytes: size }))
    }

    /// A path record (`<id>-<dev>.pm.vdh`, kind `path`, reason `moved`): the lineage's drawing now
    /// lives at `path`. No scene, no hashes (the index keeps revision `""`, which is never a real
    /// revision), full fsync like every explicit state change.
    pub fn write_path_record(&mut self, lineage: &str, path: &str) -> Result<Outcome> {
        if !(self.is_current)() {
            return Ok(Outcome::Skipped("stopped"));
        }
        if !(self.free_ok)() {
            return Ok(Outcome::DiskLow);
        }
        if !self.layout_ok {
            self.store.ensure_layout()?;
            self.layout_ok = true;
        }
        let now = self.clock.now_ms();
        let epoch = self.epoch.current(now).to_string();
        let id = self.ulid.next(now);
        let header = Header {
            format: 1,
            kind: "path".into(),
            id: id.clone(),
            lineage: lineage.to_string(),
            device: self.dev.clone(),
            epoch,
            created: now,
            reason: Reason::Moved.as_str().into(),
            path: path.to_string(),
            app: format!("vaultdraw {}", env!("CARGO_PKG_VERSION")),
            ..Header::default()
        };
        let bytes = container::write_container(&header, &[], container::ZSTD_LEVEL);
        if container::read_header(&bytes).map(|h| h.id != id).unwrap_or(true) || container::read_body(&bytes, 16).is_err() {
            return Err(err("INTERNAL", "History encoder produced an unreadable path record"));
        }
        let vname = VersionName { id: id.clone(), dev: self.dev.clone(), kind: NameKind::Path };
        if !self.guard(self.store.write_version(lineage, &vname, &bytes, true))? {
            return Ok(Outcome::DiskLow);
        }
        let head = Head { path: path.to_string(), name: None, note: None, rev: String::new(), element_count: 0, blobs: Vec::new() };
        self.index.write().unwrap_or_else(|p| p.into_inner()).insert(lineage, Entry { name: vname, size: bytes.len() as u64, dataless: false, head: Some(head) }, now);
        Ok(Outcome::Written(Written { id, lineage: lineage.to_string(), revision: String::new(), bytes: bytes.len() as u64 }))
    }

    /// `true` on success; `false` on ENOSPC (nothing partial remains); other IO errors are history
    /// errors for the caller to report (they never reach the save path).
    fn guard(&self, r: std::io::Result<()>) -> Result<bool> {
        match r {
            Ok(()) => Ok(true),
            Err(e) if store::is_enospc(&e) => Ok(false),
            Err(e) => Err(ioerr(e)),
        }
    }
}

/// The production `Backend`: a `Writer` plus the staging directory, flags and event callbacks.
pub struct RealBackend {
    pub writer: Writer,
    pub flags: Arc<staging::Flags>,
    pub staged_dir: PathBuf,
    pub on_change: Box<dyn FnMut(&str, &str) + Send>,
    pub on_error: Box<dyn FnMut(Option<(&str, &str)>) + Send>,
    pub writing: Arc<std::sync::atomic::AtomicBool>,
}

impl Backend for RealBackend {
    fn latest(&mut self, path: &str) -> Option<Latest> {
        self.writer.latest_of(path)
    }
    fn write(&mut self, req: &VersionRequest) -> Result<Outcome> {
        self.writing.store(true, std::sync::atomic::Ordering::Relaxed);
        let out = self.writer.write_version(req);
        self.writing.store(false, std::sync::atomic::Ordering::Relaxed);
        out
    }
    fn remove_clone(&mut self, file: &Path) {
        staging::remove_clone(file);
    }
    fn live_size(&mut self, file: &Path, raw: u64) -> u64 {
        store::open_regular(file).ok().and_then(|mut f| codec::live_size_from_reader(&mut f, raw).ok().flatten()).unwrap_or(raw)
    }
    fn note_path(&mut self, path: &str) {
        let key = staging::key_for(path, self.flags.fold.load(std::sync::atomic::Ordering::Relaxed));
        staging::write_sidecar(&self.staged_dir, &key, path);
    }
    fn disk_low(&mut self, keep: &HashSet<PathBuf>) {
        self.flags.disk_low.store(true, std::sync::atomic::Ordering::Relaxed);
        staging::drop_clones(&self.staged_dir, &|c| keep.contains(&c.path));
        (self.on_error)(Some(("HISTORY_DISK_LOW", "Free disk space is low; history is paused")));
    }
    fn disk_ok(&mut self) {
        if self.flags.disk_low.swap(false, std::sync::atomic::Ordering::Relaxed) {
            (self.on_error)(None);
        }
    }
    fn error(&mut self, code: &str, message: &str) {
        (self.on_error)(Some((code, message)));
    }
    fn changed(&mut self, path: &str, lineage: &str) {
        (self.on_change)(path, lineage);
    }
    fn rename_clone(&mut self, file: &Path, old: &str, new: &str) -> Option<PathBuf> {
        staging::rename_clone(&self.staged_dir, file, old, new, self.flags.fold.load(std::sync::atomic::Ordering::Relaxed))
    }
    fn drop_sidecar(&mut self, old: &str, new: &str) {
        staging::drop_sidecar_if_unused(&self.staged_dir, old, new, self.flags.fold.load(std::sync::atomic::Ordering::Relaxed));
    }
}

/// Ensures `dir` exists as a plain directory (staged dir) without following symlinks.
pub fn ensure_plain_dir(dir: &Path) -> Result<()> {
    match fs::symlink_metadata(dir) {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(err("INVALID_PATH", "State directory is not a real directory")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(dir).map_err(ioerr),
        Err(e) => Err(ioerr(e)),
    }
}
