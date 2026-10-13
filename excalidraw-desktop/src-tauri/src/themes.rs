//! Theme files in `<config dir>/themes/`.
//!
//! Two layouts are accepted: `themes/<Name>.json` and Noctalia's
//! `themes/<Name>/<Name>.json`. The raw text is returned; the frontend parses
//! and validates it. Per-file problems become entries with an `error`, never a
//! command failure. Symbolic links are never followed.
// `run()` (and thus the command wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{config, err, ioerr, read_bounded, Result};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_THEME_BYTES: u64 = 256 * 1024;
const MAX_THEMES: usize = 500;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThemeFileEntry {
    id: String,
    path: String,
    json: Option<String>,
    error: Option<String>,
}

/// A theme found while scanning, before its file is read.
enum Candidate {
    /// `themes/<Name>.json` (or a symlink/special file with that name).
    File { id: String, path: PathBuf },
    /// `themes/<Name>/`.
    Folder { id: String, path: PathBuf },
    /// Something that is a problem regardless of its contents.
    Broken { id: String, path: PathBuf, error: String },
}
impl Candidate {
    fn id(&self) -> &str {
        match self {
            Candidate::File { id, .. } | Candidate::Folder { id, .. } | Candidate::Broken { id, .. } => id,
        }
    }
    fn path(&self) -> &Path {
        match self {
            Candidate::File { path, .. } | Candidate::Folder { path, .. } | Candidate::Broken { path, .. } => path,
        }
    }
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// The stem of `name` when it ends in `.json` (case-insensitive) and has a non-empty stem.
fn json_stem(name: &str) -> Option<&str> {
    let split = name.len().checked_sub(5)?;
    if !name.is_char_boundary(split) || !name[split..].eq_ignore_ascii_case(".json") || split == 0 {
        return None;
    }
    Some(&name[..split])
}

fn entry(id: String, path: &Path, result: std::result::Result<String, String>) -> ThemeFileEntry {
    let path = path.to_string_lossy().into_owned();
    match result {
        Ok(json) => ThemeFileEntry { id, path, json: Some(json), error: None },
        Err(error) => ThemeFileEntry { id, path, json: None, error: Some(error) },
    }
}

/// Reads one theme file as UTF-8: regular files only, capped at 256 KiB.
fn read_theme_file(path: &Path) -> std::result::Result<String, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let meta = fs::symlink_metadata(path).map_err(|e| format!("Cannot read {name}: {e}"))?;
    if meta.file_type().is_symlink() {
        return Err(format!("{name} is a symbolic link; only regular files are read"));
    }
    if !meta.is_file() {
        return Err(format!("{name} is not a regular file"));
    }
    let too_large = || format!("{name} is larger than 256 KiB");
    if meta.len() > MAX_THEME_BYTES {
        return Err(too_large());
    }
    let bytes = read_bounded(path, MAX_THEME_BYTES).map_err(|e| {
        if e.code == "INVALID_FILE" { too_large() } else { format!("Cannot read {name}: {}", e.message) }
    })?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{name} is not valid UTF-8"))?;
    // A UTF-8 byte-order mark would make JSON.parse fail.
    Ok(text.strip_prefix('\u{FEFF}').map(str::to_owned).unwrap_or(text))
}

/// Resolves `themes/<Name>/`: `<Name>.json` (case-insensitive), else the only `.json` file.
fn read_theme_folder(dir: &Path, id: &str) -> (PathBuf, std::result::Result<String, String>) {
    let listing = match fs::read_dir(dir) {
        Ok(l) => l,
        Err(e) => return (dir.to_path_buf(), Err(format!("Cannot read folder {id}: {e}"))),
    };
    let mut jsons: Vec<(String, PathBuf)> = Vec::new();
    for item in listing {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if is_hidden(&name) {
            continue;
        }
        if let Some(stem) = json_stem(&name) {
            jsons.push((stem.to_string(), item.path()));
        }
    }
    jsons.sort_by(|a, b| a.1.cmp(&b.1));
    let lower = id.to_lowercase();
    let chosen = match jsons.iter().find(|(stem, _)| stem.to_lowercase() == lower) {
        Some((_, path)) => path.clone(),
        None if jsons.len() == 1 => jsons[0].1.clone(),
        None if jsons.is_empty() => {
            return (dir.to_path_buf(), Err(format!("Folder {id} contains no .json theme file; expected {id}.json")))
        }
        None => {
            return (
                dir.to_path_buf(),
                Err(format!("Folder {id} contains {} .json files and none is named {id}.json", jsons.len())),
            )
        }
    };
    let result = read_theme_file(&chosen);
    (chosen, result)
}

/// Classifies one direct child of the themes dir without following symlinks.
fn classify(item: &fs::DirEntry) -> Option<Candidate> {
    let name = item.file_name().to_string_lossy().into_owned();
    if is_hidden(&name) {
        return None;
    }
    let path = item.path();
    let file_type = match item.file_type() {
        Ok(t) => t,
        Err(e) => {
            let id = json_stem(&name).unwrap_or(&name).to_string();
            return Some(Candidate::Broken { id, path, error: format!("Cannot read {name}: {e}") });
        }
    };
    if file_type.is_dir() {
        return Some(Candidate::Folder { id: name, path });
    }
    if let Some(stem) = json_stem(&name) {
        return Some(Candidate::File { id: stem.to_string(), path });
    }
    // A symlink to a folder would look like the folder layout; report it rather than follow it.
    // (Only the link target's type is inspected; nothing behind the link is read.)
    if file_type.is_symlink() && fs::metadata(&path).is_ok_and(|m| m.is_dir()) {
        return Some(Candidate::Broken {
            id: name.clone(),
            path,
            error: format!("{name} is a symbolic link to a folder; symbolic links are not followed"),
        });
    }
    None
}

/// Lists the themes in `themes` (created if missing), sorted by id case-insensitively.
pub(crate) fn list_themes_in(themes: &Path) -> Result<Vec<ThemeFileEntry>> {
    match fs::symlink_metadata(themes) {
        Ok(m) if m.file_type().is_symlink() => {
            return Err(err("INVALID_PATH", "The themes folder is a symbolic link; symbolic links are not followed"))
        }
        Ok(m) if !m.is_dir() => return Err(err("INVALID_PATH", "The themes folder is not a folder")),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(themes).map_err(ioerr)?;
            return Ok(Vec::new());
        }
        Err(e) => return Err(ioerr(e)),
    }
    let mut candidates: Vec<Candidate> = fs::read_dir(themes)
        .map_err(ioerr)?
        .filter_map(|item| item.ok())
        .filter_map(|item| classify(&item))
        .collect();
    candidates.sort_by(|a, b| {
        a.id().to_lowercase().cmp(&b.id().to_lowercase()).then_with(|| a.path().cmp(b.path()))
    });
    candidates.truncate(MAX_THEMES);
    Ok(candidates
        .into_iter()
        .map(|c| match c {
            Candidate::File { id, path } => {
                let result = read_theme_file(&path);
                entry(id, &path, result)
            }
            Candidate::Folder { id, path } => {
                let (file, result) = read_theme_folder(&path, &id);
                entry(id, &file, result)
            }
            Candidate::Broken { id, path, error } => entry(id, &path, Err(error)),
        })
        .collect())
}

fn themes_dir() -> Result<PathBuf> {
    Ok(config::resolve_dirs()?.config.join(config::THEMES_DIR))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn list_themes() -> Result<Vec<ThemeFileEntry>> {
    list_themes_in(&themes_dir()?)
}

#[tauri::command]
pub(crate) async fn open_themes_dir() -> Result<()> {
    config::open_dir(&themes_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const THEME: &str = r##"{"dark":{"mSurface":"#000"}}"##;

    fn ids(list: &[ThemeFileEntry]) -> Vec<&str> {
        list.iter().map(|e| e.id.as_str()).collect()
    }
    fn find<'a>(list: &'a [ThemeFileEntry], id: &str) -> &'a ThemeFileEntry {
        list.iter().find(|e| e.id == id).unwrap_or_else(|| panic!("no entry {id}"))
    }

    #[test]
    fn missing_dir_is_created_and_empty() {
        let t = tempdir().unwrap();
        let dir = t.path().join("config").join("themes");
        assert_eq!(list_themes_in(&dir).unwrap(), vec![]);
        assert!(dir.is_dir());
    }

    #[test]
    fn reads_both_layouts_and_serializes_camel_case() {
        let t = tempdir().unwrap();
        let dir = t.path();
        fs::write(dir.join("Dracula.json"), THEME).unwrap();
        fs::create_dir(dir.join("Tokyo Night")).unwrap();
        fs::write(dir.join("Tokyo Night").join("Tokyo Night.json"), THEME).unwrap();
        fs::write(dir.join("Tokyo Night").join("README.md"), "x").unwrap();
        let list = list_themes_in(dir).unwrap();
        assert_eq!(ids(&list), ["Dracula", "Tokyo Night"]);
        let d = find(&list, "Dracula");
        assert_eq!(d.json.as_deref(), Some(THEME));
        assert!(d.error.is_none());
        assert_eq!(d.path, dir.join("Dracula.json").to_string_lossy());
        let n = find(&list, "Tokyo Night");
        assert_eq!(n.json.as_deref(), Some(THEME));
        assert_eq!(n.path, dir.join("Tokyo Night").join("Tokyo Night.json").to_string_lossy());

        let v = serde_json::to_value(&list[0]).unwrap();
        assert_eq!(v, serde_json::json!({"id": "Dracula", "path": d.path, "json": THEME, "error": null}));
    }

    #[test]
    fn folder_name_matching() {
        let t = tempdir().unwrap();
        let dir = t.path();
        // Case-insensitive match wins over other .json files.
        fs::create_dir(dir.join("Nord")).unwrap();
        fs::write(dir.join("Nord").join("nord.JSON"), "{\"a\":1}").unwrap();
        fs::write(dir.join("Nord").join("other.json"), "{}").unwrap();
        // No match but exactly one .json: use it.
        fs::create_dir(dir.join("Solo")).unwrap();
        fs::write(dir.join("Solo").join("palette.json"), "{\"b\":2}").unwrap();
        // No match and several .json files: error.
        fs::create_dir(dir.join("Many")).unwrap();
        fs::write(dir.join("Many").join("a.json"), "{}").unwrap();
        fs::write(dir.join("Many").join("b.json"), "{}").unwrap();
        // No .json at all: error.
        fs::create_dir(dir.join("Empty")).unwrap();
        fs::write(dir.join("Empty").join(".Empty.json"), "{}").unwrap();

        let list = list_themes_in(dir).unwrap();
        assert_eq!(ids(&list), ["Empty", "Many", "Nord", "Solo"]);
        let nord = find(&list, "Nord");
        assert_eq!(nord.json.as_deref(), Some("{\"a\":1}"));
        assert!(nord.path.ends_with("nord.JSON"));
        assert_eq!(find(&list, "Solo").json.as_deref(), Some("{\"b\":2}"));
        for id in ["Many", "Empty"] {
            let e = find(&list, id);
            assert!(e.json.is_none());
            assert!(e.error.as_deref().unwrap().contains(&format!("{id}.json")), "{:?}", e.error);
            assert_eq!(e.path, dir.join(id).to_string_lossy());
        }
    }

    #[test]
    fn oversize_and_non_utf8_are_error_entries() {
        let t = tempdir().unwrap();
        let dir = t.path();
        fs::write(dir.join("Big.json"), vec![b' '; MAX_THEME_BYTES as usize + 1]).unwrap();
        fs::write(dir.join("Edge.json"), vec![b' '; MAX_THEME_BYTES as usize]).unwrap();
        fs::write(dir.join("Latin.json"), b"{\"name\":\"caf\xe9\"}").unwrap();
        fs::write(dir.join("Bom.json"), "\u{FEFF}{}").unwrap();
        fs::create_dir(dir.join("Folder")).unwrap();
        fs::write(dir.join("Folder").join("Folder.json"), vec![b' '; MAX_THEME_BYTES as usize + 1]).unwrap();
        let list = list_themes_in(dir).unwrap();
        assert_eq!(ids(&list), ["Big", "Bom", "Edge", "Folder", "Latin"]);
        for (id, needle) in [("Big", "256 KiB"), ("Folder", "256 KiB"), ("Latin", "UTF-8")] {
            let e = find(&list, id);
            assert!(e.json.is_none());
            assert!(e.error.as_deref().unwrap().contains(needle), "{id}: {:?}", e.error);
        }
        assert_eq!(find(&list, "Edge").json.as_ref().map(String::len), Some(MAX_THEME_BYTES as usize));
        assert_eq!(find(&list, "Bom").json.as_deref(), Some("{}"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_error_entries_and_not_followed() {
        use std::os::unix::fs::symlink;
        let t = tempdir().unwrap();
        let outside = t.path().join("outside");
        fs::create_dir_all(outside.join("Linked")).unwrap();
        fs::write(outside.join("real.json"), THEME).unwrap();
        fs::write(outside.join("Linked").join("Linked.json"), THEME).unwrap();
        let dir = t.path().join("themes");
        fs::create_dir(&dir).unwrap();
        symlink(outside.join("real.json"), dir.join("FileLink.json")).unwrap();
        symlink(outside.join("Linked"), dir.join("Linked")).unwrap();
        symlink(outside.join("missing.json"), dir.join("Dangling.json")).unwrap();
        symlink(outside.join("real.json"), dir.join("notes.txt")).unwrap();
        // A symlinked file inside the folder layout is refused too.
        fs::create_dir(dir.join("Inner")).unwrap();
        symlink(outside.join("real.json"), dir.join("Inner").join("Inner.json")).unwrap();

        let list = list_themes_in(&dir).unwrap();
        assert_eq!(ids(&list), ["Dangling", "FileLink", "Inner", "Linked"]);
        for e in &list {
            assert!(e.json.is_none(), "{}", e.id);
            assert!(e.error.as_deref().unwrap().contains("symbolic link"), "{}: {:?}", e.id, e.error);
        }

        // A symlinked themes folder is refused as a whole.
        let linked_root = t.path().join("themes-link");
        symlink(&outside, &linked_root).unwrap();
        assert_eq!(list_themes_in(&linked_root).unwrap_err().code, "INVALID_PATH");
    }

    #[test]
    fn hidden_and_non_json_are_skipped_and_ids_sort_case_insensitively() {
        let t = tempdir().unwrap();
        let dir = t.path();
        for name in ["zeta.json", "Alpha.json", "beta.JSON", ".hidden.json", "notes.txt", "README", ".json"] {
            fs::write(dir.join(name), "{}").unwrap();
        }
        fs::create_dir(dir.join(".git")).unwrap();
        fs::write(dir.join(".git").join(".git.json"), "{}").unwrap();
        fs::create_dir(dir.join("Gamma")).unwrap();
        fs::write(dir.join("Gamma").join("Gamma.json"), "{}").unwrap();
        let list = list_themes_in(dir).unwrap();
        assert_eq!(ids(&list), ["Alpha", "beta", "Gamma", "zeta"]);
        assert!(list.iter().all(|e| e.error.is_none()));
    }

    #[test]
    fn caps_entries() {
        let t = tempdir().unwrap();
        let dir = t.path();
        for i in 0..MAX_THEMES + 5 {
            fs::write(dir.join(format!("t{i:04}.json")), "{}").unwrap();
        }
        let list = list_themes_in(dir).unwrap();
        assert_eq!(list.len(), MAX_THEMES);
        assert_eq!(list[0].id, "t0000");
        assert_eq!(list[MAX_THEMES - 1].id, format!("t{:04}", MAX_THEMES - 1));
    }
}
