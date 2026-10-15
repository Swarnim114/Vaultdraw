//! In-memory history index. Lineages and versions come from file NAMES (fast cold scan); headers
//! are read lazily (one 4 KiB pread) and cached. Also: path → set of lineages (M10), revision →
//! lineages, blob copies, device last-seen (local observation time, M8), case folding (Minor 13)
//! and the `index.bin` snapshot (postcard, magic `VDHI`, version, crc32; rebuilt on mismatch).

use super::{container, names::{self, BlobName, NameKind, Reason, VersionName}, store::{self, Store}};
use crate::{err, ioerr, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs,
    path::Path,
    sync::RwLock,
    time::Instant,
};

const MAGIC: &[u8; 4] = b"VDHI";
const FORMAT_VERSION: u32 = 1;
const HEADER_LEN: usize = 12;
const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;

/// What the list needs from a header (cached after the first read).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Head {
    pub path: String,
    pub name: Option<String>,
    pub note: Option<String>,
    pub rev: String,
    pub element_count: u32,
    pub blobs: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub name: VersionName,
    pub size: u64,
    pub dataless: bool,
    pub head: Option<Head>,
}

impl Entry {
    pub fn reason(&self) -> Reason {
        self.name.reason()
    }
    pub fn is_path_record(&self) -> bool {
        matches!(self.name.kind, NameKind::Path)
    }
    pub fn keyframe_id(&self) -> Option<&str> {
        match &self.name.kind {
            NameKind::Delta(_, k) => Some(k),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Lineage {
    /// Current drawing path (from the newest header that has one).
    pub path: Option<String>,
    /// id → entry (ULIDs sort by time).
    pub versions: BTreeMap<String, Entry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BlobCopy {
    pub dev: String,
    pub epoch: String,
    pub size: u64,
}

#[derive(Default)]
pub struct Index {
    pub lineages: HashMap<String, Lineage>,
    by_path: HashMap<String, BTreeSet<String>>,
    id_lineage: HashMap<String, String>,
    by_rev: HashMap<String, BTreeSet<String>>,
    /// device → local time (ms) this Mac first observed a file from it.
    pub devices: HashMap<String, u64>,
    /// `<sha>.<ext>` → every device's copy.
    pub blobs: BTreeMap<String, Vec<BlobCopy>>,
    pub fold: bool,
}

impl Index {
    pub fn new(fold: bool) -> Index {
        Index { fold, ..Default::default() }
    }

    /// Lookup key of a vault-relative path (case-folded on case-insensitive volumes).
    pub fn key(&self, path: &str) -> String {
        if self.fold { path.to_lowercase() } else { path.to_string() }
    }

    pub fn is_empty(&self) -> bool {
        self.lineages.is_empty()
    }

    pub fn version_count(&self) -> usize {
        self.lineages.values().map(|l| l.versions.len()).sum()
    }

    pub fn entry(&self, id: &str) -> Option<(&str, &Entry)> {
        let lin = self.id_lineage.get(id)?;
        let (k, l) = self.lineages.get_key_value(lin)?;
        Some((k.as_str(), l.versions.get(id)?))
    }

    pub fn insert(&mut self, lineage: &str, entry: Entry, now_ms: u64) {
        let id = entry.name.id.clone();
        if self.id_lineage.contains_key(&id) {
            return;
        }
        self.devices.entry(entry.name.dev.clone()).or_insert(now_ms);
        self.id_lineage.insert(id.clone(), lineage.to_string());
        let head = entry.head.clone();
        self.lineages.entry(lineage.to_string()).or_default().versions.insert(id.clone(), entry);
        if let Some(h) = head {
            self.by_rev.entry(h.rev).or_default().insert(lineage.to_string());
            self.refresh_path(lineage);
        }
    }

    pub fn remove(&mut self, id: &str) {
        let Some(lin) = self.id_lineage.remove(id) else { return };
        let removed = self.lineages.get_mut(&lin).and_then(|l| l.versions.remove(id));
        if let Some(h) = removed.and_then(|e| e.head) {
            self.unindex_rev(&h.rev, &lin);
        }
        let empty = self.lineages.get(&lin).is_none_or(|l| l.versions.is_empty());
        if empty {
            self.drop_lineage(&lin);
        } else {
            self.refresh_path(&lin);
        }
    }

    fn unindex_rev(&mut self, rev: &str, lin: &str) {
        let still = self.lineages.get(lin).is_some_and(|l| l.versions.values().any(|e| e.head.as_ref().is_some_and(|h| h.rev == rev)));
        if still {
            return;
        }
        if let Some(set) = self.by_rev.get_mut(rev) {
            set.remove(lin);
            if set.is_empty() {
                self.by_rev.remove(rev);
            }
        }
    }

    pub fn drop_lineage(&mut self, lin: &str) {
        if let Some(l) = self.lineages.remove(lin) {
            for id in l.versions.keys() {
                self.id_lineage.remove(id);
            }
            if let Some(p) = &l.path {
                let k = self.key(p);
                if let Some(set) = self.by_path.get_mut(&k) {
                    set.remove(lin);
                    if set.is_empty() {
                        self.by_path.remove(&k);
                    }
                }
            }
            self.by_rev.retain(|_, set| {
                set.remove(lin);
                !set.is_empty()
            });
        }
    }

    pub fn set_head(&mut self, id: &str, head: Head) {
        let Some(lin) = self.id_lineage.get(id).cloned() else { return };
        if let Some(e) = self.lineages.get_mut(&lin).and_then(|l| l.versions.get_mut(id)) {
            self.by_rev.entry(head.rev.clone()).or_default().insert(lin.clone());
            e.head = Some(head);
        }
        self.refresh_path(&lin);
    }

    /// The lineage's path = the path in its newest header.
    fn refresh_path(&mut self, lin: &str) {
        let Some(l) = self.lineages.get_mut(lin) else { return };
        let newest = l.versions.values().rev().find_map(|e| e.head.as_ref().map(|h| h.path.clone()));
        if newest == l.path {
            return;
        }
        let old = std::mem::replace(&mut l.path, newest.clone());
        if let Some(old) = old {
            let k = self.key(&old);
            if let Some(set) = self.by_path.get_mut(&k) {
                set.remove(lin);
                if set.is_empty() {
                    self.by_path.remove(&k);
                }
            }
        }
        if let Some(new) = newest {
            let k = self.key(&new);
            self.by_path.entry(k).or_default().insert(lin.to_string());
        }
    }

    pub fn lineages_for(&self, path: &str) -> Vec<&str> {
        self.by_path.get(&self.key(path)).map(|s| s.iter().map(String::as_str).collect()).unwrap_or_default()
    }

    pub fn has_lineage(&self, path: &str) -> bool {
        self.by_path.contains_key(&self.key(path))
    }

    pub fn lineages_for_revision(&self, rev: &str) -> Vec<&str> {
        self.by_rev.get(rev).map(|s| s.iter().map(String::as_str).collect()).unwrap_or_default()
    }

    /// Versions (no path records) of every lineage of `path`, newest first.
    pub fn entries_for_path(&self, path: &str) -> Vec<(&str, &Entry)> {
        let mut out: Vec<(&str, &Entry)> = Vec::new();
        for lin in self.lineages_for(path) {
            if let Some(l) = self.lineages.get(lin) {
                out.extend(l.versions.values().filter(|e| !e.is_path_record()).map(|e| (lin, e)));
            }
        }
        out.sort_by(|a, b| b.1.name.id.cmp(&a.1.name.id));
        out
    }

    pub fn latest_for_path(&self, path: &str) -> Option<(&str, &Entry)> {
        self.entries_for_path(path).into_iter().next()
    }

    /// Where a new version of `path` goes: the lineage holding this device's newest version,
    /// otherwise the lineage with the newest version, otherwise `None` (start a new lineage).
    pub fn lineage_for_write(&self, path: &str, dev: &str) -> Option<String> {
        let entries = self.entries_for_path(path);
        entries.iter().find(|(_, e)| e.name.dev == dev).or_else(|| entries.first()).map(|(l, _)| l.to_string())
    }

    pub fn total_bytes(&self) -> u64 {
        let v: u64 = self.lineages.values().flat_map(|l| l.versions.values()).map(|e| e.size).sum();
        let b: u64 = self.blobs.values().flatten().map(|c| c.size).sum();
        v + b
    }

    pub fn checkpoint_bytes(&self) -> u64 {
        self.lineages.values().flat_map(|l| l.versions.values()).filter(|e| e.reason() == Reason::Checkpoint).map(|e| e.size).sum()
    }

    /// Ids of entries whose header isn't cached yet (newest first), at most `limit`.
    pub fn unloaded_for_path(&self, path: &str, limit: usize) -> Vec<String> {
        self.entries_for_path(path).into_iter().filter(|(_, e)| e.head.is_none()).take(limit).map(|(_, e)| e.name.id.clone()).collect()
    }

    pub fn all_ids(&self) -> impl Iterator<Item = &String> {
        self.id_lineage.keys()
    }

    pub fn path_count(&self) -> usize {
        self.by_path.len()
    }
}

// ---------------------------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------------------------

/// Reads and validates the header of `name` (one 4 KiB pread normally).
pub fn load_head(store: &Store, lineage: &str, name: &VersionName) -> Result<Head> {
    let prefix = store.read_prefix(lineage, name).map_err(ioerr)?;
    let h = container::read_header(&prefix)?;
    if h.id != name.id || h.lineage != lineage {
        return Err(err("VERSION_CORRUPT", "Header does not match its file name"));
    }
    Ok(Head { path: h.path, name: h.name, note: h.note, rev: h.file_revision, element_count: h.element_count, blobs: h.blobs })
}

/// Reads the header of entry `id` into the index unless already cached; `true` if newly loaded.
pub fn ensure_head(store: &Store, index: &RwLock<Index>, id: &str) -> bool {
    let (lin, name) = {
        let g = index.read().unwrap_or_else(|p| p.into_inner());
        match g.entry(id) {
            Some((l, e)) if e.head.is_none() => (l.to_string(), e.name.clone()),
            _ => return false,
        }
    };
    match load_head(store, &lin, &name) {
        Ok(h) => {
            index.write().unwrap_or_else(|p| p.into_inner()).set_head(id, h);
            true
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------------------------
// Scan / reconcile (chunkable units)
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unit {
    Lineage(String),
    Blobs(String),
}

/// Work units for a full reconcile: one per valid lineage folder and per blob shard. Lineages that
/// vanished from disk are pruned from the index right away.
pub fn plan_units(store: &Store, index: &RwLock<Index>) -> Vec<Unit> {
    let mut units = Vec::new();
    let mut present: HashSet<String> = HashSet::new();
    if let Ok(rd) = fs::read_dir(&store.hist) {
        for e in rd.flatten() {
            let Ok(n) = e.file_name().into_string() else { continue };
            if names::is_ulid(&n) && e.file_type().is_ok_and(|t| t.is_dir()) {
                present.insert(n.clone());
                units.push(Unit::Lineage(n));
            }
        }
    }
    {
        let mut g = index.write().unwrap_or_else(|p| p.into_inner());
        let gone: Vec<String> = g.lineages.keys().filter(|k| !present.contains(*k)).cloned().collect();
        for l in gone {
            g.drop_lineage(&l);
        }
    }
    if let Ok(rd) = fs::read_dir(store.hist.join(store::BLOBS_DIR)) {
        for e in rd.flatten() {
            let Ok(n) = e.file_name().into_string() else { continue };
            if n.len() == 2 && n.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) && e.file_type().is_ok_and(|t| t.is_dir()) {
                units.push(Unit::Blobs(n));
            }
        }
    }
    units
}

/// Brings one unit in line with the disk. Returns whether the index changed.
pub fn reconcile_unit(store: &Store, index: &RwLock<Index>, unit: &Unit, now_ms: u64) -> bool {
    match unit {
        Unit::Lineage(lin) => reconcile_lineage(store, index, lin, now_ms),
        Unit::Blobs(shard) => reconcile_blobs(store, index, shard),
    }
}

fn reconcile_lineage(store: &Store, index: &RwLock<Index>, lin: &str, now_ms: u64) -> bool {
    let Ok(Some(dir)) = store.lineage_dir(lin, false) else { return false };
    let Ok(rd) = fs::read_dir(&dir) else { return false };
    let mut on_disk: HashMap<String, VersionName> = HashMap::new();
    for e in rd.flatten() {
        let Ok(file) = e.file_name().into_string() else { continue };
        if let Some(n) = VersionName::parse(&file) {
            on_disk.insert(n.id.clone(), n);
        }
    }
    let (to_add, to_remove) = {
        let g = index.read().unwrap_or_else(|p| p.into_inner());
        let known: HashSet<&String> = g.lineages.get(lin).map(|l| l.versions.keys().collect()).unwrap_or_default();
        let add: Vec<VersionName> = on_disk.values().filter(|n| !known.contains(&n.id)).cloned().collect();
        let rem: Vec<String> = known.into_iter().filter(|id| !on_disk.contains_key(*id)).cloned().collect();
        (add, rem)
    };
    if to_add.is_empty() && to_remove.is_empty() {
        return false;
    }
    let mut entries = Vec::with_capacity(to_add.len());
    for n in to_add {
        // Only regular files (never a symlink or folder dressed as a version).
        let Ok(md) = fs::symlink_metadata(dir.join(n.format())) else { continue };
        if !md.is_file() {
            continue;
        }
        entries.push(Entry { size: md.len(), dataless: store::is_dataless(&md), head: None, name: n });
    }
    let mut g = index.write().unwrap_or_else(|p| p.into_inner());
    for id in to_remove {
        g.remove(&id);
    }
    for e in entries {
        g.insert(lin, e, now_ms);
    }
    let need_path = g.lineages.get(lin).is_some_and(|l| l.path.is_none());
    let newest: Vec<(String, VersionName)> = if need_path {
        g.lineages.get(lin).map(|l| l.versions.iter().rev().take(3).map(|(id, e)| (id.clone(), e.name.clone())).collect()).unwrap_or_default()
    } else {
        Vec::new()
    };
    drop(g);
    // A lineage needs a path to be listed: read the newest header(s) now (cheap, one pread each).
    for (id, name) in newest {
        if let Ok(h) = load_head(store, lin, &name) {
            index.write().unwrap_or_else(|p| p.into_inner()).set_head(&id, h);
            break;
        }
    }
    true
}

fn reconcile_blobs(store: &Store, index: &RwLock<Index>, shard: &str) -> bool {
    let Ok(Some(dir)) = store.blob_dir(shard, false) else { return false };
    let Ok(rd) = fs::read_dir(&dir) else { return false };
    let mut found: BTreeMap<String, Vec<BlobCopy>> = BTreeMap::new();
    for e in rd.flatten() {
        let Ok(file) = e.file_name().into_string() else { continue };
        let Some(b) = BlobName::parse(&file) else { continue };
        let Ok(md) = fs::symlink_metadata(e.path()) else { continue };
        if md.is_file() {
            found.entry(b.sha_ext()).or_default().push(BlobCopy { dev: b.dev, epoch: b.epoch, size: md.len() });
        }
    }
    let mut g = index.write().unwrap_or_else(|p| p.into_inner());
    let old: Vec<String> = g.blobs.range(shard.to_string()..).take_while(|(k, _)| k.starts_with(shard)).map(|(k, _)| k.clone()).collect();
    let changed = old.len() != found.len() || old.iter().any(|k| g.blobs.get(k) != found.get(k));
    for k in old {
        g.blobs.remove(&k);
    }
    g.blobs.extend(found);
    changed
}

/// Full synchronous reconcile (cold scan). The worker runs the same units in ≤ 5 ms chunks.
pub fn scan_all(store: &Store, index: &RwLock<Index>, now_ms: u64) {
    for u in plan_units(store, index) {
        reconcile_unit(store, index, &u, now_ms);
    }
}

/// Runs units until `budget` is spent; returns the unfinished tail and whether anything changed.
pub fn reconcile_chunk(store: &Store, index: &RwLock<Index>, units: &mut Vec<Unit>, budget: std::time::Duration, now_ms: u64) -> bool {
    let start = Instant::now();
    let mut changed = false;
    while let Some(u) = units.pop() {
        changed |= reconcile_unit(store, index, &u, now_ms);
        if start.elapsed() >= budget {
            break;
        }
    }
    changed
}

// ---------------------------------------------------------------------------------------------
// index.bin
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct EntRec {
    file: String,
    size: u64,
    dataless: bool,
    head: Option<Head>,
}
#[derive(Serialize, Deserialize)]
struct LinRec {
    id: String,
    entries: Vec<EntRec>,
}
#[derive(Serialize, Deserialize)]
struct Snapshot {
    fold: bool,
    lineages: Vec<LinRec>,
    devices: Vec<(String, u64)>,
    blobs: Vec<(String, Vec<BlobCopy>)>,
}

pub fn save(path: &Path, index: &Index) -> Result<()> {
    let snap = Snapshot {
        fold: index.fold,
        lineages: index
            .lineages
            .iter()
            .map(|(id, l)| LinRec {
                id: id.clone(),
                entries: l.versions.values().map(|e| EntRec { file: e.name.format(), size: e.size, dataless: e.dataless, head: e.head.clone() }).collect(),
            })
            .collect(),
        devices: index.devices.iter().map(|(k, v)| (k.clone(), *v)).collect(),
        blobs: index.blobs.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    };
    let payload = postcard::to_allocvec(&snap).map_err(|e| err("INTERNAL", format!("History index encode failed: {e}")))?;
    let mut out = Vec::with_capacity(HEADER_LEN + payload.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&crc32fast::hash(&payload).to_le_bytes());
    out.extend_from_slice(&payload);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ioerr)?;
    }
    crate::write_atomic(path, &out)
}

/// The saved index, or `None` on any mismatch (missing, truncated, wrong magic/version, bad crc).
pub fn load(path: &Path) -> Option<Index> {
    if fs::metadata(path).ok()?.len() > MAX_SNAPSHOT_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let head = bytes.get(..HEADER_LEN)?;
    let word = |i: usize| u32::from_le_bytes([head[i], head[i + 1], head[i + 2], head[i + 3]]);
    if &head[..4] != MAGIC || word(4) != FORMAT_VERSION {
        return None;
    }
    let payload = &bytes[HEADER_LEN..];
    if crc32fast::hash(payload) != word(8) {
        return None;
    }
    let snap: Snapshot = postcard::from_bytes(payload).ok()?;
    let mut idx = Index::new(snap.fold);
    for l in snap.lineages {
        if !names::is_ulid(&l.id) {
            return None;
        }
        for e in l.entries {
            let name = VersionName::parse(&e.file)?;
            idx.insert(&l.id, Entry { name, size: e.size, dataless: e.dataless, head: e.head }, 0);
        }
    }
    idx.devices = snap.devices.into_iter().collect();
    idx.blobs = snap.blobs.into_iter().collect();
    Some(idx)
}
