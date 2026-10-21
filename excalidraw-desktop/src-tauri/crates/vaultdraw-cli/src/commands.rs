//! One handler per subcommand. Each prints its own output and returns a `Fail` on error.

use crate::cli::{Cli, CmdAction, CmdArgs, Command};
use crate::error::Fail;
use crate::rpc::{request_line, resolve_socket, Rpc};
use crate::{render, snapshot};
use clap::CommandFactory;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use vaultdraw_protocol::{methods, API_LEVEL, API_MIN};

fn emit(json: bool, value: &Value, human: impl FnOnce() -> String) {
    if json {
        println!("{}", serde_json::to_string(value).unwrap_or_default());
    } else {
        println!("{}", human());
    }
}

pub fn run(cli: &Cli) -> Result<(), Fail> {
    match &cli.command {
        Command::Completions { shell } => {
            let mut cmd = Cli::command();
            shell.generate(&mut cmd, &mut std::io::stdout());
            Ok(())
        }
        Command::Man => clap_mangen::Man::new(Cli::command()).render(&mut std::io::stdout()).map_err(|e| Fail::cli(e.to_string())),
        Command::Status => request(cli, methods::APP_STATUS, None, |v| render::status(v), true),
        Command::Methods => request(cli, methods::RPC_DISCOVER, None, |v| render::methods(v), false),
        Command::Version => version(cli),
        Command::Raw => raw(cli),
        Command::Cmd(args) => cmd(cli, args),
    }
}

/// Send one request and print its result. `status_json` makes "not running" print
/// `{"running":false}` in `--json` mode (the exit code stays 3).
fn request(cli: &Cli, method: &str, params: Option<Value>, human: impl Fn(&Value) -> String, status_json: bool) -> Result<(), Fail> {
    if cli.print_request {
        println!("{}", request_line(method, params));
        return Ok(());
    }
    let rpc = Rpc::new(resolve_socket(cli.socket.as_deref())?, cli.timeout);
    match rpc.call(method, params) {
        Ok(v) => {
            emit(cli.json, &v, || human(&v));
            Ok(())
        }
        Err(f) => {
            if status_json && cli.json && f.not_running() {
                println!("{}", json!({"running": false}));
            }
            Err(f)
        }
    }
}

fn version(cli: &Cli) -> Result<(), Fail> {
    if cli.print_request {
        println!("{}", request_line(methods::APP_STATUS, None));
        return Ok(());
    }
    let app = resolve_socket(cli.socket.as_deref())
        .ok()
        .and_then(|s| Rpc::new(s, cli.timeout.min(5)).call(methods::APP_STATUS, None).ok());
    let cli_ver = env!("CARGO_PKG_VERSION");
    let value = json!({
        "cli": cli_ver, "api": API_LEVEL, "apiMin": API_MIN,
        "app": app.as_ref().map(|a| json!({"version": a.get("app"), "api": a.get("api")})),
    });
    emit(cli.json, &value, || {
        let mut out = format!("vaultdraw {cli_ver} (api {API_LEVEL})");
        match &app {
            Some(a) => out.push_str(&format!(
                "\nVaultdraw {} (api {})",
                a.get("app").and_then(Value::as_str).unwrap_or("?"),
                a.get("api").and_then(Value::as_u64).unwrap_or(0)
            )),
            None => out.push_str("\nVaultdraw is not running"),
        }
        out
    });
    Ok(())
}

fn cmd(cli: &Cli, args: &CmdArgs) -> Result<(), Fail> {
    match (&args.action, &args.id) {
        (Some(CmdAction::List { ids }), _) => cmd_list(cli, *ids),
        (Some(CmdAction::Run { id }), _) | (None, Some(id)) => {
            let params = Some(json!({ "id": id }));
            request(
                cli,
                methods::COMMAND_RUN,
                params,
                |v| {
                    let id = v.get("id").and_then(Value::as_str).unwrap_or("");
                    if v.get("ran").and_then(Value::as_bool) == Some(false) { format!("did not run {id}") } else { format!("ran {id}") }
                },
                false,
            )
        }
        (None, None) => Err(Fail::cli("missing command id (usage: vaultdraw cmd <id> | cmd list | cmd run <id>)")),
    }
}

fn cmd_list(cli: &Cli, ids: bool) -> Result<(), Fail> {
    if cli.print_request {
        println!("{}", request_line(methods::COMMAND_LIST, None));
        return Ok(());
    }
    let live = resolve_socket(cli.socket.as_deref()).and_then(|s| Rpc::new(s, cli.timeout).call(methods::COMMAND_LIST, None));
    let result = match live {
        Ok(v) => v,
        Err(f) if f.not_running() => {
            let list = snapshot::commands().map_err(|s| if s.not_running() { f } else { s })?;
            json!({ "commands": list })
        }
        Err(f) => return Err(f),
    };
    let list = result.get("commands").and_then(Value::as_array).cloned().unwrap_or_default();
    if ids {
        let mut out = std::io::stdout().lock();
        for c in &list {
            if let Some(id) = c.get("id").and_then(Value::as_str) {
                let _ = writeln!(out, "{id}");
            }
        }
    } else {
        emit(cli.json, &result, || render::commands(&list));
    }
    Ok(())
}

/// `vaultdraw raw`: each stdin line is sent as is (it must be JSON); reply lines are printed
/// until one with an id arrives (requests without an id, i.e. notifications, get no reply).
fn raw(cli: &Cli) -> Result<(), Fail> {
    let rpc = Rpc::new(resolve_socket(cli.socket.as_deref())?, cli.timeout);
    let mut client = None;
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for (n, line) in stdin.lock().lines().enumerate() {
        let line = line.map_err(|e| Fail::cli(format!("cannot read stdin: {e}")))?;
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = serde_json::from_str(&line).map_err(|e| Fail::cli(format!("stdin line {}: invalid JSON: {e}", n + 1)))?;
        if cli.print_request {
            let _ = writeln!(out, "{}", serde_json::to_string(&req).unwrap_or_default());
            continue;
        }
        if client.is_none() {
            client = Some(rpc.connect()?);
        }
        let c = client.as_mut().expect("connected above");
        c.send(&req)?;
        if req.get("id").map_or(true, Value::is_null) {
            continue;
        }
        while let Some(reply) = c.read_line()? {
            let _ = out.write_all(&reply);
            let _ = out.write_all(b"\n");
            let is_reply = serde_json::from_slice::<Value>(&reply).is_ok_and(|v| v.get("method").is_none());
            if is_reply {
                break;
            }
        }
    }
    Ok(())
}
