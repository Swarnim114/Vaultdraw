//! Background indexer: one low-priority thread per open vault. Loads the snapshot,
//! walks the vault, parses new/changed drawings in small batches, then applies
//! watcher updates and persists the snapshot (debounced).

use super::extract::extract_doc;
use super::index::DocEntry;
use super::types::IndexState;
use super::{store, Emitter, Update, VaultIndex};
use crate::{now_ms, validate_relative, MAX_DRAWING_BYTES, META_DIR};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, mpsc::{Receiver, RecvTimeoutError}, Arc},
    time::{Duration, Instant, SystemTime},
};

const MAX_DEPTH: usize = 64;
const BATCH_DOCS: usize = 32;
const EMIT_EVERY: Duration = Duration::from_millis(250);
const SAVE_DELAY: Duration = Duration::from_secs(5);
/// Files modified this close to a reference time may have changed without a stat change.
const RACY_MS: u64 = 2000;

/// Big drawings are re-indexed only after they stop changing: a save of a 20 MB drawing would
/// otherwise cost a full re-read and parse every few hundred ms while the user types.
#[derive(Clone, Copy)]
pub(super) struct Defer {
    pub min_bytes: u64,
    pub delay: Duration,
}

impl Defer {
    pub(super) const DEFAULT: Defer = Defer { min_bytes: 4 * 1024 * 1024, delay: Duration::from_secs(5) };
}

pub(crate) struct Found {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
}

impl Found {
    fn stat(&self) -> (u64, u64) {
        (self.size, self.mtime)
    }
}

pub(crate) fn is_drawing_name(name: &str) -> bool {
    name.len() > 11 && name.get(name.len() - 11..).is_some_and(|e| e.eq_ignore_ascii_case(".excalidraw"))
}

/// Recursively lists drawings under `root/rel` (never following symlinks, skipping
/// the metadata folder and temp files). Paths are vault-relative with forward slashes.
pub(crate) fn walk(root: &Path, rel: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let mut stack = vec![(rel.to_string(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(root.join(&dir)) else { continue };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else { continue };
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() || name.starts_with(".excalidraw-tmp-") || (dir.is_empty() && name.eq_ignore_ascii_case(META_DIR)) {
                continue;
            }
            let child = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
            if ft.is_dir() {
                if depth < MAX_DEPTH && validate_relative(&child).is_ok() {
                    stack.push((child, depth + 1));
                }
            } else if ft.is_file() && is_drawing_name(&name) && validate_relative(&child).is_ok() {
                if let Ok(md) = entry.metadata() {
                    out.push(Found { path: child, size: md.len(), mtime: md.modified().map(now_ms).unwrap_or(0) });
                }
            }
        }
    }
    out
}

/// Parsed entry for one drawing file's bytes (unparseable files stay findable by name).
pub(super) fn entry_from_bytes(path: &str, stat: (u64, u64), bytes: &[u8]) -> DocEntry {
    match extract_doc(bytes) {
        Ok(x) => DocEntry::new(path, stat, x.items).with_links(x.elinks, x.hash8),
        Err(_) => DocEntry::new(path, stat, Vec::new()),
    }
}

/// Reads `path` into `buf` (reused across files, so a build faults big buffers in once, and
/// freed with the caller's `Vec` when the build ends).
fn read_into(path: &Path, buf: &mut Vec<u8>, size_hint: u64) -> crate::Result<()> {
    let need = size_hint.min(MAX_DRAWING_BYTES) as usize + 1;
    if buf.capacity() < need {
        // Replace instead of growing: growing would copy bytes we are about to overwrite.
        *buf = Vec::with_capacity(need.max(buf.capacity() * 2));
    }
    buf.clear();
    fs::File::open(path).map_err(crate::ioerr)?.take(MAX_DRAWING_BYTES + 1).read_to_end(buf).map_err(crate::ioerr)?;
    if buf.len() as u64 > MAX_DRAWING_BYTES {
        return Err(crate::err("INVALID_FILE", "File exceeds its size limit"));
    }
    Ok(())
}

fn parse(root: &Path, f: &Found, buf: &mut Vec<u8>) -> Option<(String, DocEntry)> {
    let entry = match read_into(&root.join(&f.path), buf, f.size) {
        Ok(()) => entry_from_bytes(&f.path, f.stat(), buf),
        Err(e) if e.code == "NOT_FOUND" => return None,
        // Unreadable or oversize: still findable by name.
        Err(_) => DocEntry::new(&f.path, f.stat(), Vec::new()),
    };
    Some((f.path.clone(), entry))
}

fn needs_parse(existing: Option<&DocEntry>, f: &Found, racy_before: u64) -> bool {
    match existing {
        Some(d) => !d.parsed || d.stat != f.stat() || f.mtime >= racy_before,
        None => true,
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn lower_priority() {
    extern "C" {
        fn pthread_set_qos_class_self_np(qos_class: u32, relative_priority: i32) -> i32;
    }
    const QOS_CLASS_UTILITY: u32 = 0x11;
    // SAFETY: plain libSystem call affecting only the calling thread.
    unsafe {
        pthread_set_qos_class_self_np(QOS_CLASS_UTILITY, 0);
    }
}
#[cfg(not(target_os = "macos"))]
pub(crate) fn lower_priority() {}

pub(super) struct Worker {
    pub handle: String,
    pub root: PathBuf,
    pub shared: Arc<VaultIndex>,
    pub rx: Receiver<Update>,
    pub emit: Emitter,
    pub snapshot: Option<PathBuf>,
    pub last_emit: Instant,
    pub dirty_since: Option<Instant>,
    pub defer: Defer,
    /// Big changed files and when each is due for re-indexing (reset by every new event).
    pub deferred: HashMap<String, Instant>,
}

impl Worker {
    pub(super) fn run(mut self) {
        lower_priority();
        self.startup();
        while !self.stopped() {
            let mut wait = self.dirty_since.map_or(Duration::from_secs(3600), |t| SAVE_DELAY.saturating_sub(t.elapsed()));
            if let Some(due) = self.deferred.values().min() {
                wait = wait.min(due.saturating_duration_since(Instant::now()));
            }
            match self.rx.recv_timeout(wait) {
                Ok(first) => {
                    if !self.handle_updates(first) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            self.index_due();
            if self.dirty_since.is_some_and(|t| t.elapsed() >= SAVE_DELAY) {
                self.save();
            }
        }
        if self.dirty_since.is_some() {
            self.save();
        }
    }

    fn stopped(&self) -> bool {
        self.shared.stop.load(Ordering::Relaxed)
    }

    fn emit(&mut self, force: bool) {
        if force || self.last_emit.elapsed() >= EMIT_EVERY {
            self.last_emit = Instant::now();
            (self.emit)(self.shared.status(&self.handle));
        }
    }

    fn set_state(&mut self, state: IndexState) {
        self.shared.set_state(state);
        self.emit(true);
    }

    fn save(&mut self) {
        self.dirty_since = None;
        if let Some(path) = &self.snapshot {
            let index = self.shared.read();
            if let Err(e) = store::save(path, now_ms(SystemTime::now()), &index) {
                eprintln!("vaultdraw: search index snapshot not saved: {} ({})", e.message, e.code);
            }
        }
    }

    fn startup(&mut self) {
        self.set_state(IndexState::Loading);
        let mut racy_before = now_ms(SystemTime::now()).saturating_sub(RACY_MS);
        if let Some((saved_at, index)) = self.snapshot.as_deref().and_then(store::load) {
            *self.shared.write() = index;
            racy_before = saved_at.saturating_sub(RACY_MS);
        }
        self.emit(true);
        if self.sync_subtree("", racy_before, true) {
            self.save();
        }
        self.set_state(IndexState::Ready);
    }

    /// Re-reads `rel` (a directory, or "" for the whole vault) and brings the index in line.
    fn sync_subtree(&mut self, rel: &str, racy_before: u64, report: bool) -> bool {
        let found = walk(&self.root, rel);
        let prefix = if rel.is_empty() { String::new() } else { format!("{rel}/") };
        let present: HashSet<&str> = found.iter().map(|f| f.path.as_str()).collect();
        let removed = self.shared.write().retain(|p| !p.starts_with(&prefix) || present.contains(p)) > 0;
        self.ingest(&found, racy_before, report) | removed
    }

    /// Makes every file searchable by name, then parses the new/changed ones in small batches.
    fn ingest(&mut self, found: &[Found], racy_before: u64, report: bool) -> bool {
        let mut changed = false;
        {
            let mut index = self.shared.write();
            for f in found {
                if !index.contains(&f.path) {
                    index.upsert(f.path.clone(), DocEntry::name_only(&f.path));
                    changed = true;
                }
            }
        }
        let pending: Vec<&Found> = {
            let index = self.shared.read();
            found.iter().filter(|f| needs_parse(index.get(&f.path), f, racy_before)).collect()
        };
        if pending.is_empty() {
            return changed;
        }
        if report {
            self.set_state(IndexState::Building);
        }
        let mut buf = Vec::new();
        for chunk in pending.chunks(BATCH_DOCS) {
            if self.stopped() {
                return changed;
            }
            let docs: Vec<_> = chunk.iter().filter_map(|f| parse(&self.root, f, &mut buf)).collect();
            {
                let mut index = self.shared.write();
                for (path, doc) in docs {
                    index.upsert(path, doc);
                }
            }
            changed = true;
            if report {
                self.emit(false);
            }
        }
        changed
    }

    /// Indexes deferred files whose quiet period has passed.
    fn index_due(&mut self) {
        let now = Instant::now();
        let due: Vec<String> = self.deferred.iter().filter(|(_, t)| **t <= now).map(|(p, _)| p.clone()).collect();
        if due.is_empty() {
            return;
        }
        let racy_before = now_ms(SystemTime::now()).saturating_sub(RACY_MS);
        let mut changed = false;
        for rel in due {
            self.deferred.remove(&rel);
            changed |= self.apply_file(&rel, racy_before);
        }
        if changed {
            self.emit(true);
            self.dirty_since.get_or_insert_with(Instant::now);
        }
    }

    /// Returns false when asked to shut down.
    fn handle_updates(&mut self, first: Update) -> bool {
        let mut paths = BTreeSet::new();
        let (mut rescan, mut quit) = (false, false);
        let mut take = |u: Update| match u {
            Update::Paths(p) => paths.extend(p),
            Update::Rescan => rescan = true,
            Update::Shutdown => quit = true,
        };
        take(first);
        while let Ok(next) = self.rx.try_recv() {
            take(next);
        }
        if quit {
            return false;
        }
        let racy_before = now_ms(SystemTime::now()).saturating_sub(RACY_MS);
        let changed = if rescan {
            let c = self.sync_subtree("", racy_before, true);
            self.set_state(IndexState::Ready);
            c
        } else {
            paths.iter().fold(false, |acc, p| self.apply_path(p, racy_before) | acc)
        };
        if changed {
            // Lets the UI refresh derived views (tags) without polling.
            self.emit(true);
            if self.dirty_since.is_none() {
                self.dirty_since = Some(Instant::now());
            }
        }
        true
    }

    fn apply_path(&mut self, rel: &str, racy_before: u64) -> bool {
        let md = fs::symlink_metadata(self.root.join(rel)).ok().filter(|m| !m.file_type().is_symlink());
        match md {
            None => {
                self.deferred.retain(|p, _| p != rel && !p.starts_with(&format!("{rel}/")));
                let mut index = self.shared.write();
                index.remove(rel) | (index.remove_prefix(&format!("{rel}/")) > 0)
            }
            Some(m) if m.is_dir() => self.sync_subtree(rel, racy_before, false),
            Some(m) if m.is_file() && is_drawing_name(rel) => {
                if m.len() < self.defer.min_bytes {
                    self.deferred.remove(rel);
                    return self.apply_file(rel, racy_before);
                }
                // Searchable by name now, content after the file has been quiet for `delay`.
                self.deferred.insert(rel.to_string(), Instant::now() + self.defer.delay);
                let mut index = self.shared.write();
                if index.contains(rel) {
                    false
                } else {
                    index.upsert(rel.to_string(), DocEntry::name_only(rel));
                    true
                }
            }
            Some(_) => false,
        }
    }

    /// Re-reads one drawing file now.
    fn apply_file(&mut self, rel: &str, racy_before: u64) -> bool {
        let Some(m) = fs::symlink_metadata(self.root.join(rel)).ok().filter(|m| m.is_file()) else {
            return self.shared.write().remove(rel);
        };
        let found = Found { path: rel.to_string(), size: m.len(), mtime: m.modified().map(now_ms).unwrap_or(0) };
        self.ingest(&[found], racy_before, false)
    }
}
