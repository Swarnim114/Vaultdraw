//! The method catalogue: names, JSON Schemas and which roles may call them by default.
//! `rpc.discover` returns this list; `tests/fixtures/api-v1.json` is its golden copy (a test
//! fails on any removed method or changed schema; additions regenerate the file with
//! `UPDATE_GOLDEN=1 cargo test -p vaultdraw-protocol`).

use serde_json::{json, Value};

pub const RPC_DISCOVER: &str = "rpc.discover";
pub const RPC_HELLO: &str = "rpc.hello";
pub const APP_STATUS: &str = "app.status";
pub const APP_FOCUS: &str = "app.focus";
pub const APP_OPEN: &str = "app.open";
pub const COMMAND_LIST: &str = "command.list";
pub const COMMAND_RUN: &str = "command.run";

/// Connection roles (a connection declares one with `rpc.hello`; default `cli`).
pub mod roles {
    pub const CLI: &str = "cli";
    /// `vaultdraw://` URIs and forwarded launches: the most limited role.
    pub const URI: &str = "uri";
    /// `vaultdraw mcp` (C7, gated by the AI master switch; refused until then).
    pub const MCP: &str = "mcp";
    pub const ALL: [&str; 3] = [CLI, URI, MCP];
}

/// One method of the control API.
#[derive(Debug, Clone)]
pub struct MethodSpec {
    pub name: &'static str,
    pub summary: &'static str,
    pub params: Value,
    pub result: Value,
    /// Roles allowed by default (config `[control] roles.<role>` may narrow further).
    pub roles: &'static [&'static str],
    /// Answered by the app's window (WebView bridge), not by Rust alone.
    pub window: bool,
}

impl MethodSpec {
    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "summary": self.summary,
            "params": self.params,
            "result": self.result,
            "roles": self.roles,
            "window": self.window,
        })
    }
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": true})
}

const CLI_ONLY: &[&str] = &[roles::CLI];
const CLI_URI: &[&str] = &[roles::CLI, roles::URI];

/// Every method, in a stable order.
pub fn catalogue() -> Vec<MethodSpec> {
    let none = obj(json!({}), &[]);
    vec![
        MethodSpec {
            name: RPC_DISCOVER,
            summary: "API level, app version, every method with its schemas",
            params: none.clone(),
            result: obj(
                json!({"api": {"type": "integer"}, "apiMin": {"type": "integer"}, "app": {"type": "string"}, "methods": {"type": "array"}}),
                &["api", "apiMin", "app", "methods"],
            ),
            roles: &roles::ALL,
            window: false,
        },
        MethodSpec {
            name: RPC_HELLO,
            summary: "Declare this connection's role (cli, uri, mcp) and client name",
            params: obj(json!({"role": {"type": "string"}, "client": {"type": "string"}}), &["role"]),
            result: obj(json!({"api": {"type": "integer"}, "role": {"type": "string"}}), &["api", "role"]),
            roles: &roles::ALL,
            window: false,
        },
        MethodSpec {
            name: APP_STATUS,
            summary: "Is the app running: version, pid, open vault, active drawing, tabs",
            params: none.clone(),
            result: obj(
                json!({
                    "running": {"type": "boolean"},
                    "app": {"type": "string"},
                    "api": {"type": "integer"},
                    "pid": {"type": "integer"},
                    "vault": {"type": ["object", "null"], "properties": {"name": {"type": "string"}, "path": {"type": "string"}, "readOnly": {"type": "boolean"}}},
                    "activeDrawing": {"type": ["object", "null"], "properties": {"path": {"type": "string"}, "dirty": {"type": "boolean"}}},
                    "tabs": {"type": ["integer", "null"]},
                    "windowReady": {"type": "boolean"}
                }),
                &["running", "app", "api", "pid", "vault", "windowReady"],
            ),
            roles: CLI_ONLY,
            window: false,
        },
        MethodSpec {
            name: APP_FOCUS,
            summary: "Show and focus the app window",
            params: none.clone(),
            result: obj(json!({"focused": {"type": "boolean"}}), &["focused"]),
            roles: CLI_URI,
            window: false,
        },
        MethodSpec {
            name: APP_OPEN,
            summary: "Handle a launch forwarded from a second process: argv (files, vaultdraw:// URIs) and cwd",
            params: obj(json!({"argv": {"type": "array", "items": {"type": "string"}}, "cwd": {"type": "string"}}), &["argv"]),
            result: obj(json!({"handled": {"type": "integer"}}), &["handled"]),
            roles: CLI_URI,
            window: false,
        },
        MethodSpec {
            name: COMMAND_LIST,
            summary: "Every palette command: id, title, category, keys, when clauses, available now",
            params: none.clone(),
            result: obj(
                json!({"commands": {"type": "array", "items": obj(json!({
                    "id": {"type": "string"}, "title": {"type": "string"}, "category": {"type": "string"},
                    "keys": {"type": "array", "items": {"type": "string"}}, "when": {"type": "array", "items": {"type": "string"}},
                    "available": {"type": "boolean"}
                }), &["id", "title", "category", "keys", "available"])}}),
                &["commands"],
            ),
            roles: CLI_ONLY,
            window: true,
        },
        MethodSpec {
            name: COMMAND_RUN,
            summary: "Run a palette command by id (same ids as [hotkeys]); prefix commands like drawing.open:<path> too",
            params: obj(json!({"id": {"type": "string"}}), &["id"]),
            result: obj(json!({"ran": {"type": "boolean"}, "id": {"type": "string"}}), &["ran", "id"]),
            roles: CLI_ONLY,
            window: true,
        },
    ]
}

pub fn find(name: &str) -> Option<MethodSpec> {
    catalogue().into_iter().find(|m| m.name == name)
}

/// `rpc.discover` result for an app version.
pub fn discover(app_version: &str) -> Value {
    json!({
        "api": crate::API_LEVEL,
        "apiMin": crate::API_MIN,
        "app": app_version,
        "methods": catalogue().iter().map(MethodSpec::to_json).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_unique_and_namespaced() {
        let all = catalogue();
        let mut names: Vec<_> = all.iter().map(|m| m.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), all.len());
        assert!(all.iter().all(|m| m.name.split_once('.').is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())));
    }

    /// Old properties all kept unchanged; params may not require more, results may not promise less.
    fn additive(old: &Value, new: &Value, is_params: bool) -> bool {
        let props = |v: &Value| v["properties"].as_object().cloned().unwrap_or_default();
        let req = |v: &Value| -> Vec<String> {
            v["required"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
        };
        let (op, np) = (props(old), props(new));
        let kept = op.iter().all(|(k, v)| np.get(k) == Some(v));
        let (or, nr) = (req(old), req(new));
        let required_ok = if is_params { nr.iter().all(|r| or.contains(r)) } else { or.iter().all(|r| nr.contains(r)) };
        kept && required_ok && old["type"] == new["type"]
    }

    /// The golden API description: no method may disappear or change; additions update it.
    #[test]
    fn api_v1_golden() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/api-v1.json");
        let current: Value = json!({"api": crate::API_LEVEL, "methods": catalogue().iter().map(MethodSpec::to_json).collect::<Vec<_>>()});
        let pretty = serde_json::to_string_pretty(&current).unwrap() + "\n";
        let golden: Option<Value> = std::fs::read_to_string(&path).ok().map(|t| serde_json::from_str(&t).unwrap());
        if let Some(golden) = &golden {
            for old in golden["methods"].as_array().unwrap() {
                let name = old["name"].as_str().unwrap();
                let now = current["methods"].as_array().unwrap().iter().find(|m| m["name"] == name);
                let now = now.unwrap_or_else(|| panic!("method {name} was removed (breaking change: bump API_LEVEL)"));
                assert!(additive(&old["params"], &now["params"], true), "{name}.params changed (only additive changes within an API level)");
                assert!(additive(&old["result"], &now["result"], false), "{name}.result changed (only additive changes within an API level)");
            }
        }
        if std::env::var_os("UPDATE_GOLDEN").is_some() || golden.is_none() {
            std::fs::write(&path, pretty).unwrap();
        } else {
            assert_eq!(golden.unwrap(), current, "api-v1.json is stale: rerun with UPDATE_GOLDEN=1");
        }
    }
}
