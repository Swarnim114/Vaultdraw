//! Crash journal and re-measure set, both under `<state>/links/<vault-id>/`.
//!
//! `pending.json` lists the files a rename still has to rewrite. It is written before the
//! rename and removed when the background job ends; replaying it is idempotent (a file whose
//! links already changed has nothing left to match). `remeasure.json` lists the text elements
//! Vaultdraw rewrote while their drawing was closed, so the editor re-measures just those.

use super::plan::FilePlan;
use super::types::RemeasureSet;
use crate::{err, ioerr, write_atomic, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

const JOURNAL_VERSION: u32 = 1;
const MAX_STATE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Journal {
    pub version: u32,
    pub job_id: u32,
    pub files: Vec<FilePlan>,
}

impl Journal {
    pub(crate) fn new(job_id: u32, files: Vec<FilePlan>) -> Journal {
        Journal { version: JOURNAL_VERSION, job_id, files }
    }
}

/// `<state>/links/<vault-id>`.
pub(crate) fn links_dir(state: &Path, root: &Path) -> PathBuf {
    state.join("links").join(crate::search::vault_id(root))
}

fn journal_file(dir: &Path) -> PathBuf {
    dir.join("pending.json")
}

fn remeasure_file(dir: &Path) -> PathBuf {
    dir.join("remeasure.json")
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|e| err("INTERNAL", format!("Cannot encode links state: {e}")))?;
    fs::create_dir_all(path.parent().ok_or_else(|| err("INVALID_PATH", "No parent"))?).map_err(ioerr)?;
    write_atomic(path, &bytes)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    if fs::metadata(path).ok()?.len() > MAX_STATE_BYTES {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

pub(crate) fn write_journal(dir: &Path, j: &Journal) -> Result<()> {
    write_json(&journal_file(dir), j)
}

pub(crate) fn journal_exists(dir: &Path) -> bool {
    journal_file(dir).exists()
}

/// The pending journal; an unreadable or foreign-version file reads as None.
pub(crate) fn read_journal(dir: &Path) -> Option<Journal> {
    read_json::<Journal>(&journal_file(dir)).filter(|j| j.version == JOURNAL_VERSION)
}

pub(crate) fn clear_journal(dir: &Path) {
    let _ = fs::remove_file(journal_file(dir));
}

pub(crate) fn load_remeasure(dir: &Path) -> RemeasureSet {
    read_json(&remeasure_file(dir)).unwrap_or_default()
}

fn save_remeasure(dir: &Path, set: &RemeasureSet) -> Result<()> {
    if set.paths.is_empty() {
        let _ = fs::remove_file(remeasure_file(dir));
        return Ok(());
    }
    write_json(&remeasure_file(dir), set)
}

/// Adds element ids per drawing (merging with what is there).
pub(crate) fn add_remeasure(dir: &Path, add: Vec<(String, Vec<String>)>) -> Result<()> {
    if add.is_empty() {
        return Ok(());
    }
    let mut set = load_remeasure(dir);
    for (path, ids) in add {
        let e = set.paths.entry(path).or_default();
        for id in ids {
            if !e.contains(&id) {
                e.push(id);
            }
        }
    }
    save_remeasure(dir, &set)
}

pub(crate) fn remeasure_done(dir: &Path, path: &str) -> Result<()> {
    let mut set = load_remeasure(dir);
    if set.paths.remove(path).is_some() {
        save_remeasure(dir, &set)?;
    }
    Ok(())
}

/// Follows drawings that moved: `(old, new)` paths.
pub(crate) fn remap_remeasure(dir: &Path, moves: &[(String, String)]) -> Result<()> {
    if !remeasure_file(dir).exists() {
        return Ok(());
    }
    let mut set = load_remeasure(dir);
    let mut changed = false;
    for (old, new) in moves {
        if let Some(ids) = set.paths.remove(old) {
            set.paths.insert(new.clone(), ids);
            changed = true;
        }
    }
    if changed {
        save_remeasure(dir, &set)?;
    }
    Ok(())
}
