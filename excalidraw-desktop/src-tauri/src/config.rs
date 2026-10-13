//! User configuration folder (`config.toml`, `themes/`) and machine state (`state.json`).
//!
//! See `personal/planning/config.md` for the contract implemented here.
// `run()` (and thus the command/watcher wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{err, ioerr, read_bounded, write_atomic, write_atomic_new, NativeError, Result};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_STATE_BYTES: u64 = 1024 * 1024;
const MAX_CHANGES: usize = 256;
const CONFIG_FILE: &str = "config.toml";
const STATE_FILE: &str = "state.json";
pub(crate) const THEMES_DIR: &str = "themes";
const TEMP_PREFIX: &str = ".excalidraw-tmp-";
const DEBOUNCE: Duration = Duration::from_millis(150);
const MAX_BATCH_DELAY: Duration = Duration::from_millis(1000);

/// Written verbatim on first launch (when `config.toml` does not exist).
pub(crate) const DEFAULT_CONFIG: &str = r##"# Vaultdraw configuration
# Edit by hand or in Settings; changes apply live.
# Delete a line to go back to its default.

[appearance]
# Colour theme: a built-in name or a theme in the themes/ folder
theme = "Default"
# light | dark | system
mode = "system"
# Make the canvas background, pencil and palette colours follow the theme
sync_canvas = false
# Canvas background for new drawings when sync_canvas is off
canvas_background = "#ffffff"

[editor]
# Defaults for new elements
# 5 Excalifont, 6 Nunito, 8 Comic Shanns, 1 Virgil, 2 Helvetica, 3 Cascadia
font_family = 5
font_size = 20
stroke_color = "#1e1e1e"
background_color = "transparent"
# solid | hachure | cross-hatch
fill_style = "solid"
stroke_width = 2
# 0 architect, 1 artist, 2 cartoonist
roughness = 1

[saving]
# Milliseconds of idle time before an edit is written to disk
autosave_delay_ms = 500

[interface]
# Whole-app zoom in percent (Cmd+Shift +/-/0)
# zoom = 100

[navigator]
# name_asc | name_desc | modified_desc | modified_asc
# sort = "name_asc"

[files]
# Folder for new drawings, relative to the vault root (empty = next to the open drawing)
# new_drawing_folder = ""

[hotkeys]
# Override a command's keys; [] removes them. Example:
# "vault.newDrawing" = ["Mod+N"]
"##;

/// Serializes every config/state write within the process.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn write_guard() -> Result<std::sync::MutexGuard<'static, ()>> {
    WRITE_LOCK
        .lock()
        .map_err(|_| err("INTERNAL", "Config write state unavailable"))
}

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Dirs {
    pub config: PathBuf,
    pub state: PathBuf,
}
impl Dirs {
    fn config_file(&self) -> PathBuf {
        self.config.join(CONFIG_FILE)
    }
    fn state_file(&self) -> PathBuf {
        self.state.join(STATE_FILE)
    }
}

/// Pure resolution: `get` reads an environment variable, `windows` selects the
/// platform table and `smoke_root` (smoke-test builds only) replaces the platform
/// default when the override is unset. Empty variables count as unset; relative
/// XDG values are ignored as the XDG spec requires.
pub(crate) fn resolve_dirs_with(
    get: impl Fn(&str) -> Option<OsString>,
    windows: bool,
    smoke_root: Option<&Path>,
) -> Result<Dirs> {
    let var = |name: &str| get(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    let abs = |name: &str| var(name).filter(|p| p.is_absolute());
    let resolve = |override_var: &str, smoke_leaf: &str, xdg: &str, xdg_rel: &str, win: &str| -> Result<PathBuf> {
        if let Some(p) = var(override_var) {
            if !p.is_absolute() {
                return Err(err("CONFIG_DIR", format!("{override_var} must be an absolute path")));
            }
            return Ok(p);
        }
        if let Some(root) = smoke_root {
            return Ok(root.join(smoke_leaf));
        }
        if windows {
            return abs(win)
                .map(|p| p.join("Vaultdraw"))
                .ok_or_else(|| err("CONFIG_DIR", format!("%{win}% is not set")));
        }
        if let Some(p) = abs(xdg) {
            return Ok(p.join("vaultdraw"));
        }
        abs("HOME")
            .map(|home| home.join(xdg_rel).join("vaultdraw"))
            .ok_or_else(|| err("CONFIG_DIR", "Cannot determine the home directory ($HOME is not set)"))
    };
    Ok(Dirs {
        config: resolve("VAULTDRAW_CONFIG_DIR", "config", "XDG_CONFIG_HOME", ".config", "APPDATA")?,
        state: resolve("VAULTDRAW_STATE_DIR", "state", "XDG_STATE_HOME", ".local/state", "LOCALAPPDATA")?,
    })
}

pub(crate) fn resolve_dirs() -> Result<Dirs> {
    #[cfg(feature = "smoke-test")]
    let smoke_root = Some(std::env::temp_dir().join("vaultdraw-smoke"));
    #[cfg(not(feature = "smoke-test"))]
    let smoke_root: Option<PathBuf> = None;
    resolve_dirs_with(|k: &str| std::env::var_os(k), cfg!(windows), smoke_root.as_deref())
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigError {
    pub(crate) message: String,
    pub(crate) line: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedSettings {
    config_dir: String,
    config_path: String,
    state_path: String,
    config: Option<Json>,
    config_error: Option<ConfigError>,
    state: Json,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigChange {
    pub(crate) key: String,
    #[serde(default)]
    pub(crate) value: Json,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConfigChangeEvent {
    paths: Vec<String>,
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/// Creates the config dir, `themes/` and a default `config.toml` if missing.
fn ensure_config_files(dirs: &Dirs) -> Result<()> {
    fs::create_dir_all(&dirs.config).map_err(ioerr)?;
    let themes = dirs.config.join(THEMES_DIR);
    if fs::symlink_metadata(&themes).is_err() {
        fs::create_dir_all(&themes).map_err(ioerr)?;
    }
    let path = dirs.config_file();
    match fs::symlink_metadata(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            match write_atomic_new(&path, DEFAULT_CONFIG.as_bytes()) {
                // Another writer created it first; keep theirs.
                Err(e) if e.code == "NAME_COLLISION" => Ok(()),
                other => other,
            }
        }
        Err(e) => Err(ioerr(e)),
    }
}

/// Reads `config.toml` as UTF-8: regular files only, capped at 1 MiB.
fn read_config_text(path: &Path) -> Result<String> {
    read_toml_text(path, CONFIG_FILE, MAX_CONFIG_BYTES)
}

/// Reads a TOML settings file named `name` as UTF-8: regular files only (symbolic
/// links are refused), capped at `max` bytes.
pub(crate) fn read_toml_text(path: &Path, name: &str, max: u64) -> Result<String> {
    let meta = fs::symlink_metadata(path).map_err(ioerr)?;
    if meta.file_type().is_symlink() {
        return Err(err("INVALID_PATH", format!("{name} is a symbolic link; only regular files are read")));
    }
    if !meta.is_file() {
        return Err(err("INVALID_PATH", format!("{name} is not a regular file")));
    }
    let bytes = read_bounded(path, max)
        .map_err(|e| if e.code == "INVALID_FILE" { err("INVALID_FILE", format!("{name} exceeds {}", size_label(max))) } else { e })?;
    String::from_utf8(bytes).map_err(|_| err("INVALID_FILE", format!("{name} is not valid UTF-8")))
}

fn size_label(bytes: u64) -> String {
    if bytes >= 1024 * 1024 && bytes % (1024 * 1024) == 0 {
        format!("{} MiB", bytes / (1024 * 1024))
    } else {
        format!("{} KiB", bytes / 1024)
    }
}

fn line_of(text: &str, offset: usize) -> usize {
    let end = offset.min(text.len());
    text.as_bytes()[..end].iter().filter(|b| **b == b'\n').count() + 1
}

fn toml_to_json(v: toml::Value) -> Json {
    match v {
        toml::Value::String(s) => Json::String(s),
        toml::Value::Integer(i) => Json::from(i),
        toml::Value::Float(f) => serde_json::Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        toml::Value::Boolean(b) => Json::Bool(b),
        toml::Value::Datetime(d) => Json::String(d.to_string()),
        toml::Value::Array(a) => Json::Array(a.into_iter().map(toml_to_json).collect()),
        toml::Value::Table(t) => table_to_json(t),
    }
}
fn table_to_json(t: toml::Table) -> Json {
    Json::Object(t.into_iter().map(|(k, v)| (k, toml_to_json(v))).collect())
}

/// Parses TOML text into a JSON object, or a `{ message, line }` error.
pub(crate) fn parse_config(text: &str) -> std::result::Result<Json, ConfigError> {
    toml::from_str::<toml::Table>(text).map(table_to_json).map_err(|e| ConfigError {
        message: e.message().trim().to_string(),
        line: e.span().map(|s| line_of(text, s.start)),
    })
}

fn read_state(path: &Path) -> Json {
    let empty = || Json::Object(Default::default());
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() => {}
        _ => return empty(),
    }
    read_bounded(path, MAX_STATE_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Json>(&bytes).ok())
        .filter(Json::is_object)
        .unwrap_or_else(empty)
}

pub(crate) fn load_settings_in(dirs: &Dirs) -> Result<LoadedSettings> {
    {
        let _guard = write_guard()?;
        ensure_config_files(dirs)?;
    }
    let config_path = dirs.config_file();
    let (config, config_error) = match read_config_text(&config_path) {
        Ok(text) => match parse_config(&text) {
            Ok(json) => (Some(json), None),
            Err(e) => (None, Some(e)),
        },
        Err(e) => (None, Some(ConfigError { message: e.message, line: None })),
    };
    let state_path = dirs.state_file();
    Ok(LoadedSettings {
        config_dir: dirs.config.to_string_lossy().into_owned(),
        config_path: config_path.to_string_lossy().into_owned(),
        state_path: state_path.to_string_lossy().into_owned(),
        config,
        config_error,
        state: read_state(&state_path),
    })
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/// Splits `table.key` on the **first** dot: the table name is `[A-Za-z0-9_-]`, the
/// key may also contain dots (`hotkeys.vault.newDrawing` → `hotkeys` / `vault.newDrawing`),
/// which `toml_edit` writes as a quoted key. A key without a dot is a root key.
fn split_key(key: &str) -> Result<(Option<&str>, &str)> {
    let bad = || err("INVALID_ARGUMENT", format!("Invalid config key \"{key}\"; expected \"table.key\""));
    let valid = |s: &str, dots: bool| {
        !s.is_empty()
            && s.len() <= 64
            && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || (dots && c == '.'))
            && !s.starts_with('.')
            && !s.ends_with('.')
            && !s.contains("..")
    };
    match key.split_once('.') {
        None if valid(key, false) => Ok((None, key)),
        Some((t, k)) if valid(t, false) && valid(k, true) => Ok((Some(t), k)),
        _ => Err(bad()),
    }
}

fn json_to_toml(key: &str, v: &Json, nested: bool) -> Result<toml_edit::Value> {
    let bad = |what: &str| err("INVALID_ARGUMENT", format!("Unsupported value for \"{key}\": {what}"));
    Ok(match v {
        Json::Bool(b) => (*b).into(),
        Json::String(s) => s.as_str().into(),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.into()
            } else if n.is_u64() {
                return Err(bad("integer out of range"));
            } else {
                n.as_f64().ok_or_else(|| bad("number"))?.into()
            }
        }
        Json::Array(items) if !nested => {
            let mut arr = toml_edit::Array::new();
            for item in items {
                arr.push(json_to_toml(key, item, true)?);
            }
            arr.into()
        }
        Json::Array(_) => return Err(bad("nested arrays")),
        Json::Object(_) => return Err(bad("objects")),
        Json::Null => return Err(bad("null inside an array")),
    })
}

/// Applies `changes` to `config.toml` text, preserving comments, order and formatting.
/// Removing a key that took the place of a commented example from [`DEFAULT_CONFIG`]
/// puts that example back, so setting and then removing a key restores the text.
pub(crate) fn apply_changes(text: &str, changes: &[ConfigChange]) -> Result<String> {
    edit_toml(text, changes, CONFIG_FILE, MAX_CONFIG_BYTES, Some(DEFAULT_CONFIG), false)
}

/// Applies `changes` to the TOML text of the file `name` (a per-vault settings file),
/// preserving comments, order and formatting. Everything is validated first, so a bad
/// change applies nothing. A table left empty and uncommented by a removal is dropped.
pub(crate) fn apply_toml_changes(text: &str, changes: &[ConfigChange], name: &str, max: u64) -> Result<String> {
    edit_toml(text, changes, name, max, None, true)
}

/// `defaults` is the text whose commented examples a removal may restore; `prune` drops
/// tables that a removal leaves without values or comments of their own.
fn edit_toml(
    text: &str,
    changes: &[ConfigChange],
    name: &str,
    max: u64,
    defaults: Option<&str>,
    prune: bool,
) -> Result<String> {
    if changes.len() > MAX_CHANGES {
        return Err(err("INVALID_ARGUMENT", "Too many config changes in one call"));
    }
    if let Err(e) = parse_config(text) {
        let at = e.line.map(|l| format!(" (line {l})")).unwrap_or_default();
        return Err(err("CONFIG_INVALID", format!("{name} does not parse{at}: {}", e.message)));
    }
    let mut doc: toml_edit::DocumentMut = text
        .parse()
        .map_err(|e: toml_edit::TomlError| err("CONFIG_INVALID", format!("{name} does not parse: {}", e.message())))?;
    // Validate everything before mutating so a bad change applies nothing.
    let mut planned = Vec::with_capacity(changes.len());
    for change in changes {
        let (table, key) = split_key(&change.key)?;
        let value = if change.value.is_null() { None } else { Some(json_to_toml(&change.key, &change.value, false)?) };
        planned.push((table, key, value));
    }
    for (table, key, value) in planned {
        let root = doc.as_table_mut();
        let target: &mut dyn toml_edit::TableLike = match table {
            None => root,
            Some(t) => {
                if !root.contains_key(t) {
                    if value.is_none() {
                        continue;
                    }
                    root.insert(t, toml_edit::Item::Table(toml_edit::Table::new()));
                }
                root.get_mut(t)
                    .and_then(toml_edit::Item::as_table_like_mut)
                    .ok_or_else(|| err("INVALID_ARGUMENT", format!("\"{t}\" in {name} is not a table")))?
            }
        };
        match value {
            None => remove_key(&mut doc, table, key, defaults, prune),
            Some(mut new) => match target.get_mut(key) {
                Some(existing) if existing.is_value() => {
                    if let Some(old) = existing.as_value() {
                        *new.decor_mut() = old.decor().clone();
                    }
                    *existing = toml_edit::Item::Value(new);
                }
                Some(_) => {
                    return Err(err("INVALID_ARGUMENT", format!("\"{}\" in {name} is a table, not a value", change_key(table, key))))
                }
                None => {
                    target.insert(key, toml_edit::Item::Value(new));
                    if let Some(t) = table {
                        adopt_commented_default(&mut doc, t, key);
                    }
                }
            },
        }
    }
    let out = doc.to_string();
    if out.len() as u64 > max {
        return Err(err("INVALID_FILE", format!("{name} would exceed {}", size_label(max))));
    }
    Ok(out)
}
fn change_key(table: Option<&str>, key: &str) -> String {
    table.map(|t| format!("{t}.{key}")).unwrap_or_else(|| key.to_string())
}

/// True when `line` is a commented-out assignment of `key`, e.g. `# zoom = 1.0` or
/// `# "vault.newDrawing" = ["Mod+N"]`.
fn is_commented_assignment(line: &str, key: &str) -> bool {
    let Some(rest) = line.trim_start().strip_prefix('#') else { return false };
    let rest = rest.trim_start();
    let (name, after) = if let Some(quoted) = rest.strip_prefix('"') {
        match quoted.split_once('"') {
            Some((name, after)) => (name, after),
            None => return false,
        }
    } else {
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .unwrap_or(rest.len());
        rest.split_at(end)
    };
    name == key && after.trim_start().starts_with('=')
}

/// Where the comments that follow a table's last value live in `toml_edit`: the prefix
/// of the next explicit table (as a path from the root), or the document trailer.
enum Gap {
    Table(Vec<String>),
    Trailing,
}

/// The gap after `table` (`None`: the root table, whose values precede every table).
/// `None` when the table is implicit or has no document position (created in this edit).
fn gap_after(doc: &toml_edit::DocumentMut, table: Option<&str>) -> Option<Gap> {
    fn positions(t: &toml_edit::Table, path: &mut Vec<String>, out: &mut Vec<(isize, Vec<String>)>) {
        for (k, item) in t.iter() {
            if let Some(sub) = item.as_table() {
                path.push(k.to_string());
                if let Some(pos) = sub.position().filter(|_| !sub.is_implicit()) {
                    out.push((pos, path.clone()));
                }
                positions(sub, path, out);
                path.pop();
            }
        }
    }
    let own_pos = match table {
        None => isize::MIN,
        Some(t) => {
            let own = doc.get(t)?.as_table()?;
            if own.is_implicit() {
                return None;
            }
            own.position()?
        }
    };
    let mut all = Vec::new();
    positions(doc.as_table(), &mut Vec::new(), &mut all);
    let next = all.into_iter().filter(|(p, _)| *p > own_pos).min_by_key(|(p, _)| *p).map(|(_, path)| path);
    Some(next.map_or(Gap::Trailing, Gap::Table))
}
fn gap_text(doc: &toml_edit::DocumentMut, gap: &Gap) -> Option<String> {
    match gap {
        Gap::Table(path) => table_at(doc, path)?.decor().prefix()?.as_str().map(str::to_owned),
        Gap::Trailing => doc.trailing().as_str().map(str::to_owned),
    }
}
fn set_gap_text(doc: &mut toml_edit::DocumentMut, gap: &Gap, text: String) {
    match gap {
        Gap::Table(path) => {
            if let Some(t) = table_at_mut(doc, path) {
                t.decor_mut().set_prefix(text);
            }
        }
        Gap::Trailing => doc.set_trailing(text),
    }
}

/// Finds the commented example for `key` in the gap after `table`: the gap's lines
/// before it, the example line itself and the lines after it.
fn commented_example(doc: &toml_edit::DocumentMut, table: &str, key: &str) -> Option<(Gap, String, String, String)> {
    let gap = gap_after(doc, Some(table))?;
    let text = gap_text(doc, &gap)?;
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let i = lines.iter().position(|l| is_commented_assignment(l, key))?;
    let (before, line, after) = (lines[..i].concat(), lines[i].to_owned(), lines[i + 1..].concat());
    Some((gap, before, line, after))
}

/// A key newly added to an explicit `[table]` is appended after the table's last value,
/// i.e. *before* any comments that follow it (`toml_edit` stores those as the prefix of
/// the next table, or as the document trailer). If those comments contain a commented
/// default for the key (`# zoom = 1.0`), the new value takes that line's place and the
/// comments above it become the key's own comments, so the documentation stays with it.
fn adopt_commented_default(doc: &mut toml_edit::DocumentMut, table: &str, key: &str) {
    let Some((gap, before, _, after)) = commented_example(doc, table, key) else { return };
    set_gap_text(doc, &gap, after);
    if let Some(mut k) = doc.get_mut(table).and_then(toml_edit::Item::as_table_mut).and_then(|t| t.key_mut(key)) {
        k.leaf_decor_mut().set_prefix(before);
    }
}

/// Removes `key` from `table` without losing the comments above it: they move to the
/// next value in the table, or (for the table's last value) into the gap after the table.
/// When the key had taken the place of a commented example in `defaults` (see
/// [`adopt_commented_default`]), that example line is restored below those comments, so
/// set-then-remove gives back the original text. With `prune`, a table left without
/// values or comments of its own is dropped.
fn remove_key(doc: &mut toml_edit::DocumentMut, table: Option<&str>, key: &str, defaults: Option<&str>, prune: bool) {
    let target: &mut dyn toml_edit::TableLike = match table {
        None => doc.as_table_mut(),
        Some(t) => match doc.get_mut(t).and_then(toml_edit::Item::as_table_like_mut) {
            Some(target) => target,
            None => return,
        },
    };
    let Some(comments) = target.key(key).map(|k| k.leaf_decor().prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned())
    else {
        return;
    };
    let next_key = target
        .iter()
        .skip_while(|(k, _)| *k != key)
        .skip(1)
        .find(|(_, item)| item.is_value())
        .map(|(k, _)| k.to_owned());
    target.remove(key);
    let now_empty = target.is_empty();

    // The example line to restore, if the key replaced one from `defaults`.
    let example = match (defaults, table) {
        (Some(d), Some(t)) => d
            .parse::<toml_edit::DocumentMut>()
            .ok()
            .and_then(|d| commented_example(&d, t, key))
            .filter(|(_, before, _, _)| !before.is_empty() && comments.ends_with(before.as_str()))
            .map(|(_, _, line, _)| line),
        _ => None,
    };
    let mut moved = comments.clone();

    if let Some(next) = next_key {
        if let Some(mut k) = target.key_mut(&next) {
            let existing = k.leaf_decor().prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned();
            if let Some(line) = example.filter(|_| !existing.lines().any(|l| is_commented_assignment(l, key))) {
                moved.push_str(&line);
            }
            if !moved.is_empty() {
                k.leaf_decor_mut().set_prefix(moved + &existing);
            }
        }
        return;
    }
    let Some(gap) = gap_after(doc, table) else {
        // A table created in this same edit: nothing of the original text to keep.
        if prune && now_empty {
            if let Some(t) = table {
                doc.as_table_mut().remove(t);
            }
        }
        return;
    };
    let Some(existing) = gap_text(doc, &gap) else { return };
    if let Some(line) = example.filter(|_| !existing.lines().any(|l| is_commented_assignment(l, key))) {
        moved.push_str(&line);
    }
    if !moved.is_empty() {
        set_gap_text(doc, &gap, moved.clone() + &existing);
    }
    if prune && now_empty && !comments.contains('#') {
        if let Some(t) = table {
            prune_table(doc, t, &gap, &(moved + &existing));
        }
    }
}

/// Drops the empty `[table]` unless a comment belongs to it: one on its header line, or
/// one directly above the header. Comments above it that are separated by a blank line
/// (e.g. a file header) move into `gap`, whose current text is `gap_now`.
fn prune_table(doc: &mut toml_edit::DocumentMut, table: &str, gap: &Gap, gap_now: &str) {
    let Some(t) = doc.get(table).and_then(toml_edit::Item::as_table) else { return };
    if t.is_implicit() || !t.is_empty() {
        return;
    }
    let decor = t.decor();
    let suffix = decor.suffix().and_then(|r| r.as_str()).unwrap_or("");
    let prefix = decor.prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned();
    let attached = prefix.split_inclusive('\n').last().is_some_and(|l| l.contains('#'));
    if suffix.contains('#') || attached {
        return;
    }
    doc.as_table_mut().remove(table);
    if prefix.contains('#') {
        let text = if gap_now.trim().is_empty() { prefix } else { prefix + gap_now };
        set_gap_text(doc, gap, text);
    }
}
fn table_at<'a>(doc: &'a toml_edit::DocumentMut, path: &[String]) -> Option<&'a toml_edit::Table> {
    path.iter().try_fold(doc.as_table(), |t, k| t.get(k)?.as_table())
}
fn table_at_mut<'a>(doc: &'a mut toml_edit::DocumentMut, path: &[String]) -> Option<&'a mut toml_edit::Table> {
    path.iter().try_fold(doc.as_table_mut(), |t, k| t.get_mut(k)?.as_table_mut())
}

pub(crate) fn update_config_in(dirs: &Dirs, changes: &[ConfigChange]) -> Result<()> {
    let _guard = write_guard()?;
    ensure_config_files(dirs)?;
    let path = dirs.config_file();
    let text = read_config_text(&path)?;
    let updated = apply_changes(&text, changes)?;
    if updated != text {
        write_atomic(&path, updated.as_bytes())?;
    }
    Ok(())
}

pub(crate) fn write_state_in(dirs: &Dirs, state: &Json) -> Result<()> {
    if !state.is_object() {
        return Err(err("INVALID_ARGUMENT", "state must be a JSON object"));
    }
    let mut bytes = serde_json::to_vec_pretty(state).map_err(|e| err("INTERNAL", e.to_string()))?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err(err("INVALID_FILE", "state.json would exceed 1 MiB"));
    }
    let _guard = write_guard()?;
    fs::create_dir_all(&dirs.state).map_err(ioerr)?;
    write_atomic(&dirs.state_file(), &bytes)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn load_settings() -> Result<LoadedSettings> {
    load_settings_in(&resolve_dirs()?)
}

#[tauri::command]
pub(crate) async fn update_config(changes: Vec<ConfigChange>) -> Result<()> {
    update_config_in(&resolve_dirs()?, &changes)
}

#[tauri::command]
pub(crate) async fn write_state(state: Json) -> Result<()> {
    write_state_in(&resolve_dirs()?, &state)
}

#[tauri::command]
pub(crate) async fn open_config_dir() -> Result<()> {
    let dirs = resolve_dirs()?;
    open_dir(&dirs.config)
}

/// Creates `dir` if missing and opens it in the platform file manager.
pub(crate) fn open_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).map_err(ioerr)?;
    let dir = dir.to_string_lossy().into_owned();
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "linux")]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(ioerr)
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/// Keeps the config-dir watcher alive for the lifetime of the app (managed state).
pub(crate) struct ConfigWatcher {
    _watcher: Mutex<RecommendedWatcher>,
}

fn is_temp_file(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(TEMP_PREFIX))
}

/// Splits `<config>/library.excalidrawlib` out of a batch of changed paths: it is reported
/// by `library-change` instead of `config-change`. Returns the remaining paths and whether
/// the library file was among them.
fn split_library_paths(root: &Path, paths: Vec<String>) -> (Vec<String>, bool) {
    let is_library = |p: &str| {
        let p = Path::new(p);
        p.parent() == Some(root) && p.file_name().is_some_and(|n| n == super::library::LIBRARY_FILE)
    };
    let is_lock = |p: &str| Path::new(p).file_name().is_some_and(|n| n == super::library::LOCK_FILE);
    let (library, rest): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| is_library(p));
    (rest.into_iter().filter(|p| !is_lock(p)).collect(), !library.is_empty())
}

/// Watches the config dir recursively and emits debounced `config-change` events.
pub(crate) fn start_watcher(app: &AppHandle) -> std::result::Result<ConfigWatcher, NativeError> {
    let dirs = resolve_dirs()?;
    {
        let _guard = write_guard()?;
        ensure_config_files(&dirs)?;
    }
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let app = app.clone();
    let root = dirs.config.clone();
    thread::Builder::new()
        .name("config-watcher".into())
        .spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut batch = vec![first];
                let started = Instant::now();
                // Trailing debounce: wait for DEBOUNCE of quiet, bounded by MAX_BATCH_DELAY.
                loop {
                    let left = MAX_BATCH_DELAY.saturating_sub(started.elapsed());
                    if left.is_zero() {
                        break;
                    }
                    match rx.recv_timeout(DEBOUNCE.min(left)) {
                        Ok(event) => batch.push(event),
                        Err(_) => break,
                    }
                }
                let mut paths = Vec::new();
                let mut failed = false;
                for event in batch {
                    match event {
                        Ok(e) => paths.extend(
                            e.paths
                                .into_iter()
                                .filter(|p| !is_temp_file(p))
                                .map(|p| p.to_string_lossy().into_owned()),
                        ),
                        Err(_) => failed = true,
                    }
                }
                paths.sort();
                paths.dedup();
                let (paths, library_changed) = split_library_paths(&root, paths);
                let mut paths = paths;
                if library_changed || failed {
                    super::library::emit_change(&app, None);
                }
                if paths.is_empty() && failed {
                    paths.push(root.to_string_lossy().into_owned());
                }
                if !paths.is_empty() {
                    let _ = app.emit("config-change", ConfigChangeEvent { paths });
                }
            }
        })
        .map_err(ioerr)?;
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let _ = tx.send(event);
    })
    .map_err(|e| err("WATCH_FAILED", e.to_string()))?;
    watcher
        .watch(&dirs.config, RecursiveMode::Recursive)
        .map_err(|e| err("WATCH_FAILED", e.to_string()))?;
    Ok(ConfigWatcher { _watcher: Mutex::new(watcher) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_path_is_split_from_config_changes() {
        let root = Path::new("/c/vaultdraw");
        let s = |v: &[&str]| v.iter().map(|p| p.to_string()).collect::<Vec<_>>();
        assert_eq!(split_library_paths(root, s(&["/c/vaultdraw/library.excalidrawlib"])), (vec![], true));
        // Our lock and temp files never count as a library (or config) change.
        assert_eq!(
            split_library_paths(root, s(&["/c/vaultdraw/.library.excalidrawlib.lock"])),
            (vec![], false)
        );
        assert_eq!(
            split_library_paths(root, s(&["/c/vaultdraw/config.toml", "/c/vaultdraw/library.excalidrawlib"])),
            (s(&["/c/vaultdraw/config.toml"]), true)
        );
        assert_eq!(
            split_library_paths(root, s(&["/c/vaultdraw/themes/library.excalidrawlib", "/c/vaultdraw/config.toml"])),
            (s(&["/c/vaultdraw/themes/library.excalidrawlib", "/c/vaultdraw/config.toml"]), false)
        );
    }
    use serde_json::json;
    use std::collections::HashMap;
    use tempfile::tempdir;

    fn dirs_in(root: &Path) -> Dirs {
        Dirs { config: root.join("config"), state: root.join("state") }
    }
    fn change(key: &str, value: Json) -> ConfigChange {
        ConfigChange { key: key.into(), value }
    }
    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = vars.iter().map(|(k, v)| (k.to_string(), OsString::from(v))).collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn first_load_writes_default_config_verbatim_and_themes_dir() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        let loaded = load_settings_in(&d).unwrap();
        assert_eq!(fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap(), DEFAULT_CONFIG);
        assert!(d.config.join(THEMES_DIR).is_dir());
        assert!(loaded.config_error.is_none());
        assert_eq!(loaded.state, json!({}));
        let out = serde_json::to_value(&loaded).unwrap();
        for k in ["configDir", "configPath", "statePath", "config", "configError", "state"] {
            assert!(out.get(k).is_some(), "{k}");
        }
        assert!(out["configError"].is_null());
        // A second load keeps an edited file.
        fs::write(d.config.join(CONFIG_FILE), "x = 1\n").unwrap();
        assert_eq!(load_settings_in(&d).unwrap().config, Some(json!({"x": 1})));
    }

    #[test]
    fn default_config_parses_to_json() {
        let v = parse_config(DEFAULT_CONFIG).unwrap();
        assert_eq!(v["appearance"]["theme"], "Default");
        assert_eq!(v["appearance"]["mode"], "system");
        assert_eq!(v["appearance"]["sync_canvas"], false);
        assert_eq!(v["editor"]["font_family"], 5);
        assert_eq!(v["editor"]["background_color"], "transparent");
        assert_eq!(v["saving"]["autosave_delay_ms"], 500);
        assert_eq!(parse_config("a = 1.5\nb = [1, 2]").unwrap(), json!({"a": 1.5, "b": [1, 2]}));
    }

    #[test]
    fn parse_error_reports_one_based_line() {
        let e = parse_config("[appearance]\nmode = \"dark\"\ntheme = \n").unwrap_err();
        assert_eq!(e.line, Some(3));
        assert!(!e.message.is_empty());
        assert_eq!(parse_config("= 1").unwrap_err().line, Some(1));

        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join(CONFIG_FILE), "a = 1\nb = \"unterminated\n").unwrap();
        let loaded = load_settings_in(&d).unwrap();
        assert!(loaded.config.is_none());
        assert_eq!(loaded.config_error.unwrap().line, Some(2));
    }

    #[test]
    fn update_preserves_comments_order_and_other_keys() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        update_config_in(&d, &[change("appearance.mode", json!("dark")), change("editor.font_size", json!(28))]).unwrap();
        let text = fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap();
        let expected = DEFAULT_CONFIG
            .replace("mode = \"system\"", "mode = \"dark\"")
            .replace("font_size = 20", "font_size = 28");
        assert_eq!(text, expected);
    }

    #[test]
    fn update_keeps_trailing_comments_and_creates_missing_tables() {
        let src = "# top\n[editor]\nfont_size = 20 # big\nroughness = 1\n";
        let out = apply_changes(
            src,
            &[
                change("editor.font_size", json!(12)),
                change("editor.fill_style", json!("hachure")),
                change("saving.autosave_delay_ms", json!(750)),
                change("appearance.tags", json!(["a", "b"])),
                change("appearance.ratio", json!(0.5)),
            ],
        )
        .unwrap();
        assert!(out.starts_with("# top\n[editor]\nfont_size = 12 # big\nroughness = 1\nfill_style = \"hachure\"\n"), "{out}");
        let v = parse_config(&out).unwrap();
        assert_eq!(v["saving"]["autosave_delay_ms"], 750);
        assert_eq!(v["appearance"]["tags"], json!(["a", "b"]));
        assert_eq!(v["appearance"]["ratio"], 0.5);
    }

    #[test]
    fn null_removes_key_and_missing_removals_are_noops() {
        let out = apply_changes(
            DEFAULT_CONFIG,
            &[change("appearance.mode", Json::Null), change("nothing.here", Json::Null)],
        )
        .unwrap();
        let v = parse_config(&out).unwrap();
        assert!(v["appearance"].get("mode").is_none());
        assert_eq!(v["appearance"]["theme"], "Default");
        assert!(v.get("nothing").is_none());
        assert!(out.contains("# Colour theme"));
    }

    #[test]
    fn rejects_bad_keys_and_values_without_partial_application() {
        for (k, v) in [("a.b..c", json!(1)), ("a.b.", json!(1)), (".a", json!(1)), ("a.", json!(1)), ("a.b c", json!(1)), ("a.b\"c", json!(1)), ("a.b/c", json!(1)), ("", json!(1)), ("a b.c", json!(1)), ("a.b", json!({"x": 1})), ("a.b", json!([[1]])), ("a.b", json!(u64::MAX))] {
            let e = apply_changes(DEFAULT_CONFIG, &[change("appearance.mode", json!("dark")), change(k, v)]).unwrap_err();
            assert_eq!(e.code, "INVALID_ARGUMENT", "{k}");
        }
        assert_eq!(apply_changes("[editor]\n", &[change("editor", json!(1))]).unwrap_err().code, "INVALID_ARGUMENT");
    }

    #[test]
    fn split_key_uses_the_first_dot_only() {
        assert_eq!(split_key("hotkeys.vault.newDrawing").unwrap(), (Some("hotkeys"), "vault.newDrawing"));
        assert_eq!(split_key("appearance.mode").unwrap(), (Some("appearance"), "mode"));
        assert_eq!(split_key("root").unwrap(), (None, "root"));
        assert_eq!(split_key("hotkeys.view.zoom-in_2").unwrap(), (Some("hotkeys"), "view.zoom-in_2"));
    }

    #[test]
    fn dotted_hotkey_keys_round_trip_quoted_with_comments_preserved() {
        let src = "# top\n[hotkeys]\n# mine\n\"file.save\" = [\"Mod+S\"] # keep\n\n[saving]\nautosave_delay_ms = 500\n";
        let out = apply_changes(
            src,
            &[
                change("hotkeys.vault.newDrawing", json!(["Mod+N", "Mod+Alt+N"])),
                change("hotkeys.view.toggleNavigator", json!([])),
                change("hotkeys.file.save", json!(["Mod+Shift+S"])),
            ],
        )
        .unwrap();
        assert_eq!(
            out,
            "# top\n[hotkeys]\n# mine\n\"file.save\" = [\"Mod+Shift+S\"] # keep\n\"vault.newDrawing\" = [\"Mod+N\", \"Mod+Alt+N\"]\n\"view.toggleNavigator\" = []\n\n[saving]\nautosave_delay_ms = 500\n"
        );
        let v = parse_config(&out).unwrap();
        assert_eq!(v["hotkeys"]["vault.newDrawing"], json!(["Mod+N", "Mod+Alt+N"]));
        assert_eq!(v["hotkeys"]["view.toggleNavigator"], json!([]));
        assert_eq!(v["hotkeys"]["file.save"], json!(["Mod+Shift+S"]));
        // Removing restores the default (line deleted); other comments stay.
        let out = apply_changes(&out, &[change("hotkeys.vault.newDrawing", Json::Null), change("hotkeys.view.toggleNavigator", Json::Null)]).unwrap();
        assert_eq!(out, src.replace("[\"Mod+S\"]", "[\"Mod+Shift+S\"]"));
    }

    #[test]
    fn load_settings_returns_dotted_hotkeys_as_flat_keys() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        update_config_in(&d, &[change("hotkeys.vault.newDrawing", json!(["Mod+N"])), change("hotkeys.file.rename", json!([]))]).unwrap();
        let config = load_settings_in(&d).unwrap().config.unwrap();
        assert_eq!(config["hotkeys"]["vault.newDrawing"], json!(["Mod+N"]));
        assert_eq!(config["hotkeys"]["file.rename"], json!([]));
        let text = fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap();
        // The commented example is replaced by the real binding; its explanation stays above it.
        assert!(
            text.ends_with("[hotkeys]\n# Override a command's keys; [] removes them. Example:\n\"vault.newDrawing\" = [\"Mod+N\"]\n\"file.rename\" = []\n"),
            "{text}"
        );
    }

    #[test]
    fn default_config_documents_upcoming_tables_without_values() {
        for section in ["[interface]\n# Whole-app zoom", "# zoom = 100", "[navigator]\n", "# sort = \"name_asc\"", "[files]\n", "# new_drawing_folder = \"\"", "[hotkeys]\n", "# \"vault.newDrawing\" = [\"Mod+N\"]"] {
            assert!(DEFAULT_CONFIG.contains(section), "{section}");
        }
        let v = parse_config(DEFAULT_CONFIG).unwrap();
        for table in ["interface", "navigator", "files", "hotkeys"] {
            assert_eq!(v[table], json!({}), "{table}");
        }
    }

    #[test]
    fn new_keys_land_in_their_commented_tables() {
        let out = apply_changes(
            DEFAULT_CONFIG,
            &[change("interface.zoom", json!(125)), change("navigator.sort", json!("modified_desc")), change("files.new_drawing_folder", json!("Inbox"))],
        )
        .unwrap();
        assert!(
            out.contains("[interface]\n# Whole-app zoom in percent (Cmd+Shift +/-/0)\nzoom = 125\n\n[navigator]\n# name_asc | name_desc | modified_desc | modified_asc\nsort = \"modified_desc\"\n\n[files]\n# Folder for new drawings, relative to the vault root (empty = next to the open drawing)\nnew_drawing_folder = \"Inbox\"\n\n[hotkeys]\n"),
            "{out}"
        );
        assert_eq!(out.matches("[interface]").count(), 1);
        let v = parse_config(&out).unwrap();
        assert_eq!(v["interface"]["zoom"], 125);
        assert_eq!(v["navigator"]["sort"], "modified_desc");
        // Everything before the new tables is untouched.
        let head = &DEFAULT_CONFIG[..DEFAULT_CONFIG.find("[interface]").unwrap()];
        assert!(out.starts_with(head));
        // A key that isn't documented by a comment is simply appended to its table.
        let out = apply_changes(DEFAULT_CONFIG, &[change("interface.show_hints", json!(false))]).unwrap();
        assert!(out.contains("[interface]\nshow_hints = false\n# Whole-app zoom"), "{out}");
        assert_eq!(parse_config(&out).unwrap()["interface"]["show_hints"], false);
    }

    /// Every setting documented in DEFAULT_CONFIG: `(table, key, default, line, commented)`.
    /// Uncommented keys come from the parsed default; commented examples (`# key = value`)
    /// from the text, under the `[table]` they appear in.
    fn default_settings() -> Vec<(String, String, Json, String, bool)> {
        let parsed = parse_config(DEFAULT_CONFIG).unwrap();
        let mut table = String::new();
        let mut found = Vec::new();
        for line in DEFAULT_CONFIG.lines() {
            if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
                table = name.to_string();
                continue;
            }
            let (body, commented) = match line.strip_prefix("# ") {
                Some(rest) => (rest, true),
                None => (line, false),
            };
            if table.is_empty() || body.is_empty() {
                continue;
            }
            let Ok(Json::Object(kv)) = parse_config(body) else { continue };
            let (key, value) = kv.into_iter().next().unwrap();
            found.push((table.clone(), key, value, line.to_string(), commented));
        }
        // The text scan sees exactly the parsed default's values.
        let mut uncommented: Vec<_> = found.iter().filter(|f| !f.4).map(|f| (f.0.clone(), f.1.clone(), f.2.clone())).collect();
        let mut expected = Vec::new();
        for (t, keys) in parsed.as_object().unwrap() {
            for (k, v) in keys.as_object().unwrap() {
                expected.push((t.clone(), k.clone(), v.clone()));
            }
        }
        uncommented.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
        expected.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
        assert_eq!(uncommented, expected);
        found
    }
    fn other_value(v: &Json) -> Json {
        match v {
            Json::String(s) => json!(format!("{s}x")),
            Json::Number(n) => json!(n.as_i64().unwrap() + 1),
            Json::Bool(b) => json!(!b),
            Json::Array(_) => json!(["Mod+Shift+X"]),
            other => panic!("unexpected default {other}"),
        }
    }
    fn comment_lines(text: &str) -> Vec<&str> {
        text.lines().filter(|l| l.trim_start().starts_with('#')).collect()
    }

    #[test]
    fn set_then_remove_keeps_every_comment_of_the_default_config() {
        let settings = default_settings();
        assert_eq!(settings.iter().filter(|s| s.4).count(), 4, "{settings:?}");
        for (table, key, default, line, commented) in settings {
            let k = format!("{table}.{key}");
            let set = apply_changes(DEFAULT_CONFIG, &[change(&k, other_value(&default))]).unwrap();
            assert_eq!(parse_config(&set).unwrap()[&table][&key], other_value(&default), "{k}");
            let removed = apply_changes(&set, &[change(&k, Json::Null)]).unwrap();
            assert!(parse_config(&removed).unwrap()[&table].get(&key).is_none(), "{k}");
            if commented {
                // The example line was replaced by the value and comes back on removal.
                assert!(!set.contains(&line), "{k}");
                assert_eq!(removed, DEFAULT_CONFIG, "{k}");
                // And the cycle repeats.
                let again = apply_changes(&removed, &[change(&k, other_value(&default))]).unwrap();
                assert_eq!(again, set, "{k}");
            } else {
                // The key's line is gone; its comments stay where they were.
                assert_eq!(removed, DEFAULT_CONFIG.replacen(&format!("{line}\n"), "", 1), "{k}");
                assert_eq!(comment_lines(&removed), comment_lines(DEFAULT_CONFIG), "{k}");
            }
        }
    }

    #[test]
    fn hotkey_set_and_remove_round_trips_the_default_config() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        update_config_in(&d, &[change("hotkeys.vault.newDrawing", json!(["Mod+N"]))]).unwrap();
        let path = d.config.join(CONFIG_FILE);
        assert_ne!(fs::read_to_string(&path).unwrap(), DEFAULT_CONFIG);
        update_config_in(&d, &[change("hotkeys.vault.newDrawing", Json::Null)]).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), DEFAULT_CONFIG);

        // Several keys at once, removed in a different order.
        let set = apply_changes(
            DEFAULT_CONFIG,
            &[change("hotkeys.vault.newDrawing", json!(["Mod+N"])), change("hotkeys.file.save", json!([])), change("interface.zoom", json!(90))],
        )
        .unwrap();
        let out = apply_changes(
            &set,
            &[change("hotkeys.file.save", Json::Null), change("interface.zoom", Json::Null), change("hotkeys.vault.newDrawing", Json::Null)],
        )
        .unwrap();
        assert_eq!(out, DEFAULT_CONFIG);
        let out = apply_changes(
            &set,
            &[change("hotkeys.vault.newDrawing", Json::Null), change("hotkeys.file.save", Json::Null), change("interface.zoom", Json::Null)],
        )
        .unwrap();
        assert_eq!(out, DEFAULT_CONFIG);
    }

    #[test]
    fn removal_moves_comments_to_the_next_key_or_the_gap_after_the_table() {
        let src = "top = 1\n# about a\na = 1\n\n[t]\n# about x\nx = 1 # inline\n# about y\ny = 2\n# tail\n";
        let out = apply_changes(src, &[change("t.x", Json::Null)]).unwrap();
        assert_eq!(out, "top = 1\n# about a\na = 1\n\n[t]\n# about x\n# about y\ny = 2\n# tail\n");
        let out = apply_changes(&out, &[change("t.y", Json::Null), change("a", Json::Null)]).unwrap();
        assert_eq!(out, "top = 1\n# about a\n\n[t]\n# about x\n# about y\n# tail\n");
        // Without a matching comment block, no example line is invented.
        let out = apply_changes("[interface]\nzoom = 120\n", &[change("interface.zoom", Json::Null)]).unwrap();
        assert_eq!(out, "[interface]\n");
    }

    #[test]
    fn commented_assignment_matching() {
        assert!(is_commented_assignment("# zoom = 1.0\n", "zoom"));
        assert!(is_commented_assignment("  #zoom=1", "zoom"));
        assert!(is_commented_assignment("# \"vault.newDrawing\" = [\"Mod+N\"]\n", "vault.newDrawing"));
        assert!(!is_commented_assignment("# zoomed = 1", "zoom"));
        assert!(!is_commented_assignment("# Whole-app zoom in percent (Cmd+Shift +/-/0)", "zoom"));
        assert!(!is_commented_assignment("zoom = 1", "zoom"));
        assert!(!is_commented_assignment("# vault.newDrawing = []", "vault.newDrawing"));
    }

    #[test]
    fn invalid_config_is_refused_and_left_untouched() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        let broken = "# mine\n[appearance\nmode = \"dark\"\n";
        fs::write(d.config.join(CONFIG_FILE), broken).unwrap();
        let e = update_config_in(&d, &[change("appearance.mode", json!("light"))]).unwrap_err();
        assert_eq!(e.code, "CONFIG_INVALID");
        assert_eq!(fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap(), broken);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_config_is_refused() {
        use std::os::unix::fs::symlink;
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        let target = t.path().join("elsewhere.toml");
        fs::write(&target, "x = 1\n").unwrap();
        symlink(&target, d.config.join(CONFIG_FILE)).unwrap();
        let loaded = load_settings_in(&d).unwrap();
        assert!(loaded.config.is_none());
        assert!(loaded.config_error.is_some());
        assert_eq!(update_config_in(&d, &[change("x", json!(2))]).unwrap_err().code, "INVALID_PATH");
        assert_eq!(fs::read_to_string(target).unwrap(), "x = 1\n");
    }

    #[test]
    fn oversized_config_is_reported() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join(CONFIG_FILE), vec![b'#'; MAX_CONFIG_BYTES as usize + 1]).unwrap();
        let loaded = load_settings_in(&d).unwrap();
        assert!(loaded.config.is_none());
        assert_eq!(loaded.config_error.unwrap().line, None);
    }

    #[test]
    fn state_roundtrips_and_bad_state_reads_as_empty() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        let state = json!({"recentVaults": ["/a"], "lastVaultPath": null, "navigatorCollapsed": false, "navigatorWidth": 280, "expandedFolders": {"x": true}});
        write_state_in(&d, &state).unwrap();
        assert_eq!(load_settings_in(&d).unwrap().state, state);
        assert_eq!(write_state_in(&d, &json!([1])).unwrap_err().code, "INVALID_ARGUMENT");
        let big = json!({"x": "y".repeat(MAX_STATE_BYTES as usize)});
        assert_eq!(write_state_in(&d, &big).unwrap_err().code, "INVALID_FILE");
        fs::write(d.state.join(STATE_FILE), "{nope").unwrap();
        assert_eq!(load_settings_in(&d).unwrap().state, json!({}));
        fs::write(d.state.join(STATE_FILE), "[1]").unwrap();
        assert_eq!(load_settings_in(&d).unwrap().state, json!({}));
    }

    #[test]
    fn resolves_overrides_xdg_home_windows_and_smoke() {
        let o = resolve_dirs_with(env(&[("VAULTDRAW_CONFIG_DIR", "/o/c"), ("VAULTDRAW_STATE_DIR", "/o/s"), ("HOME", "/h")]), false, Some(Path::new("/tmp/vs"))).unwrap();
        assert_eq!(o, Dirs { config: "/o/c".into(), state: "/o/s".into() });

        let x = resolve_dirs_with(env(&[("XDG_CONFIG_HOME", "/x/c"), ("XDG_STATE_HOME", "/x/s"), ("HOME", "/h")]), false, None).unwrap();
        assert_eq!(x, Dirs { config: "/x/c/vaultdraw".into(), state: "/x/s/vaultdraw".into() });

        let h = resolve_dirs_with(env(&[("XDG_CONFIG_HOME", ""), ("XDG_STATE_HOME", "relative"), ("HOME", "/h")]), false, None).unwrap();
        assert_eq!(h, Dirs { config: "/h/.config/vaultdraw".into(), state: "/h/.local/state/vaultdraw".into() });

        let s = resolve_dirs_with(env(&[("VAULTDRAW_CONFIG_DIR", "/o/c"), ("HOME", "/h")]), false, Some(Path::new("/tmp/vs"))).unwrap();
        assert_eq!(s, Dirs { config: "/o/c".into(), state: "/tmp/vs/state".into() });

        assert_eq!(resolve_dirs_with(env(&[("VAULTDRAW_CONFIG_DIR", "rel")]), false, None).unwrap_err().code, "CONFIG_DIR");
        assert_eq!(resolve_dirs_with(env(&[]), false, None).unwrap_err().code, "CONFIG_DIR");

        #[cfg(windows)]
        {
            let w = resolve_dirs_with(env(&[("APPDATA", r"C:\R"), ("LOCALAPPDATA", r"C:\L")]), true, None).unwrap();
            assert_eq!(w, Dirs { config: PathBuf::from(r"C:\R").join("Vaultdraw"), state: PathBuf::from(r"C:\L").join("Vaultdraw") });
        }
        #[cfg(not(windows))]
        {
            let w = resolve_dirs_with(env(&[("APPDATA", "/r"), ("LOCALAPPDATA", "/l"), ("XDG_CONFIG_HOME", "/x")]), true, None).unwrap();
            assert_eq!(w, Dirs { config: "/r/Vaultdraw".into(), state: "/l/Vaultdraw".into() });
        }
    }
}
