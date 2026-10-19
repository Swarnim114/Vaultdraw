//! `manifest.json`: path -> (size, mtime, rev). Only a hint that lets lookup skip rehashing.
use super::store::write_atomic;
use crate::Result;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::Path};

const FILE: &str = "manifest.json";
const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    pub size: u64,
    pub mtime_ms: u64,
    pub rev: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct Manifest {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    pub entries: HashMap<String, Entry>,
}

impl Manifest {
    /// Missing, unreadable or foreign-version files give an empty manifest (it is only a cache).
    pub fn load(cache: &Path) -> Manifest {
        fs::read(cache.join(FILE))
            .ok()
            .and_then(|b| serde_json::from_slice::<Manifest>(&b).ok())
            .filter(|m| m.version == VERSION)
            .unwrap_or_default()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let m = Manifest { version: VERSION, entries: self.entries.clone() };
        serde_json::to_vec(&m).unwrap_or_default()
    }

    pub fn save_bytes(cache: &Path, bytes: &[u8]) -> Result<()> {
        write_atomic(&cache.join(FILE), bytes)
    }

    /// Insert; returns true when the entry changed.
    pub fn set(&mut self, path: &str, entry: Entry) -> bool {
        self.entries.insert(path.to_string(), entry.clone()).as_ref() != Some(&entry)
    }

    pub fn remove(&mut self, path: &str) -> bool {
        self.entries.remove(path).is_some()
    }

    pub fn revs(&self) -> std::collections::HashSet<String> {
        self.entries.values().map(|e| e.rev.clone()).collect()
    }
}
