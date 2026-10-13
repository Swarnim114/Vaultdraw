//! Optional packaged-app smoke bridge. This module is compiled only with `smoke-test`.
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf, sync::{Mutex, OnceLock}};
use tauri::AppHandle;

const ENV_DIR: &str = "EXCALIDRAW_VAULT_SMOKE_DIR";
static REPORT: OnceLock<Mutex<Vec<Value>>> = OnceLock::new();

fn report() -> &'static Mutex<Vec<Value>> {
    REPORT.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn enabled() -> bool {
    env::var_os(ENV_DIR).is_some_and(|value| !value.is_empty())
}

/// Resolve only the explicit test folder; it is never inferred from cwd or app data.
pub fn test_dir() -> Result<PathBuf, String> {
    let value = env::var_os(ENV_DIR).ok_or_else(|| format!("{ENV_DIR} is not set"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{ENV_DIR} must be an absolute path"));
    }
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err(format!("{ENV_DIR} must name a directory"));
    }
    path.canonicalize().map_err(|error| error.to_string())
}

/// Resolve the export sandbox after canonicalizing it so a symlink cannot escape the test folder.
pub fn export_dir() -> Result<PathBuf, String> {
    let root = test_dir()?;
    let path = root.join("smoke-exports");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    let resolved = path.canonicalize().map_err(|error| error.to_string())?;
    if !resolved.starts_with(&root) || !resolved.is_dir() {
        return Err("smoke export directory escaped the configured test folder".into());
    }
    Ok(resolved)
}

#[tauri::command]
pub fn smoke_environment() -> Result<Value, String> {
    let root = test_dir()?;
    Ok(json!({ "enabled": true, "vaultPath": root.to_string_lossy(), "exportPath": root.join("smoke-exports").to_string_lossy() }))
}

#[tauri::command]
pub fn smoke_log(step: String, ok: bool, details: Option<Value>) -> Result<(), String> {
    let record = json!({ "step": step, "ok": ok, "details": details });
    report().lock().map_err(|_| "smoke report lock poisoned".to_string())?.push(record);
    Ok(())
}

#[tauri::command]
pub fn smoke_finish(app: AppHandle, status: i32, details: Option<Value>) -> Result<(), String> {
    let root = test_dir()?;
    let steps = report().lock().map_err(|_| "smoke report lock poisoned".to_string())?.clone();
    let report = json!({ "status": status, "steps": steps, "details": details });
    let path = root.join("smoke-report.json");
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("smoke-report.json must be a regular file, not a symlink".into());
        }
    }
    fs::write(path, serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    app.exit(status);
    Ok(())
}

