//! Offline fallback for `cmd list`: the registry snapshot the app writes to its state dir.

use crate::error::Fail;
use serde_json::Value;
use std::path::PathBuf;
use vaultdraw_protocol::dirs::resolve_dirs_with;

pub fn path() -> Result<PathBuf, Fail> {
    resolve_dirs_with(|k| std::env::var_os(k), cfg!(windows), None).map(|d| d.state.join("commands.json")).map_err(Fail::cli)
}

/// Commands from the snapshot, `available` removed (it only means something in a live app).
/// Accepts `{"commands": [...]}` or a bare array.
pub fn commands() -> Result<Vec<Value>, Fail> {
    let p = path()?;
    let text = std::fs::read_to_string(&p).map_err(|e| {
        Fail::new(
            crate::error::EXIT_NOT_RUNNING,
            format!("Vaultdraw is not running and there is no command snapshot at {} ({e})", p.display()),
            "NOT_RUNNING",
        )
    })?;
    let v: Value = serde_json::from_str(&text).map_err(|e| Fail::cli(format!("{} is not valid JSON: {e}", p.display())))?;
    let list = match v {
        Value::Array(a) => a,
        Value::Object(mut o) => match o.remove("commands") {
            Some(Value::Array(a)) => a,
            _ => return Err(Fail::cli(format!("{} has no \"commands\" array", p.display()))),
        },
        _ => return Err(Fail::cli(format!("{} has an unexpected shape", p.display()))),
    };
    Ok(list
        .into_iter()
        .map(|mut c| {
            if let Value::Object(o) = &mut c {
                o.remove("available");
            }
            c
        })
        .collect())
}
