//! Human text (not a stable interface). `--json` bypasses this module.

use serde_json::Value;
use std::fmt::Write;

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn status(v: &Value) -> String {
    let mut out = String::new();
    let _ = write!(
        out,
        "Vaultdraw {} (api {}, pid {})",
        s(v, "app"),
        v.get("api").and_then(Value::as_u64).unwrap_or(0),
        v.get("pid").and_then(Value::as_u64).unwrap_or(0)
    );
    match v.get("vault").filter(|x| x.is_object()) {
        Some(vault) => {
            let ro = if vault.get("readOnly").and_then(Value::as_bool) == Some(true) { " [read-only]" } else { "" };
            let _ = write!(out, "\nvault: {} ({}){ro}", s(vault, "name"), s(vault, "path"));
        }
        None => out.push_str("\nvault: none open"),
    }
    if let Some(d) = v.get("activeDrawing").filter(|x| x.is_object()) {
        let dirty = if d.get("dirty").and_then(Value::as_bool) == Some(true) { " (unsaved)" } else { "" };
        let _ = write!(out, "\ndrawing: {}{dirty}", s(d, "path"));
    }
    if let Some(t) = v.get("tabs").and_then(Value::as_u64) {
        let _ = write!(out, "\ntabs: {t}");
    }
    if v.get("windowReady").and_then(Value::as_bool) == Some(false) {
        out.push_str("\nwindow: loading");
    }
    out
}

/// Left-aligned columns, two spaces apart, no trailing spaces.
fn table(rows: &[Vec<String>]) -> String {
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let widths: Vec<usize> =
        (0..cols).map(|c| rows.iter().filter_map(|r| r.get(c)).map(|x| x.chars().count()).max().unwrap_or(0)).collect();
    rows.iter()
        .map(|r| {
            let line = r
                .iter()
                .enumerate()
                .map(|(i, cell)| format!("{cell:<w$}", w = widths[i]))
                .collect::<Vec<_>>()
                .join("  ");
            line.trim_end().to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn methods(v: &Value) -> String {
    let rows: Vec<Vec<String>> = v
        .get("methods")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|m| vec![s(m, "name").to_string(), s(m, "summary").to_string()]).collect())
        .unwrap_or_default();
    table(&rows)
}

pub fn commands(list: &[Value]) -> String {
    let with_avail = list.iter().any(|c| c.get("available").is_some());
    let mut rows = vec![{
        let mut h = vec!["ID".to_string(), "TITLE".to_string(), "CATEGORY".to_string(), "KEYS".to_string()];
        if with_avail {
            h.push("AVAILABLE".into());
        }
        h
    }];
    for c in list {
        let keys = c
            .get("keys")
            .and_then(Value::as_array)
            .map(|k| k.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        let mut row = vec![s(c, "id").to_string(), s(c, "title").to_string(), s(c, "category").to_string(), keys];
        if with_avail {
            row.push(if c.get("available").and_then(Value::as_bool) == Some(true) { "yes" } else { "no" }.into());
        }
        rows.push(row);
    }
    table(&rows)
}
