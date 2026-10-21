//! The control socket server: blocking accept loop, one thread per connection, NDJSON
//! JSON-RPC 2.0. Knows nothing about Tauri; the app plugs in through [`Dispatch`].

use serde_json::{json, Value};
use std::io::{self, BufReader};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use vaultdraw_protocol::dirs::InstancePaths;
use vaultdraw_protocol::frame::{read_frame, write_frame, FrameError};
use vaultdraw_protocol::methods::{self, roles, RPC_HELLO};
use vaultdraw_protocol::{codes, Id, Request, Response, RpcError, API_LEVEL, INVALID_REQUEST, MAX_FRAME_BYTES, PARSE_ERROR};

/// Connections served at once; more are dropped (a runaway client must not exhaust threads).
const MAX_CONNECTIONS: usize = 64;

/// Executes an allowed call. `role` is the connection's role; the server has already checked
/// the method exists and the role may call it.
pub(crate) trait Dispatch: Send + Sync + 'static {
    fn call(&self, role: &str, method: &str, params: Option<Value>) -> Result<Value, RpcError>;
}

/// Injectable peer check (tests simulate another user).
#[derive(Clone, Copy)]
pub(crate) struct ServerConfig {
    pub peer_uid: fn(RawFd) -> io::Result<u32>,
    pub my_uid: u32,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self { peer_uid: vaultdraw_protocol::peer::peer_uid, my_uid: vaultdraw_protocol::peer::my_uid() }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct ServerHandle {
    socket: PathBuf,
    stop: Arc<AtomicBool>,
}

impl ServerHandle {
    /// Stops accepting and removes the socket (tests; the app leaves it for the next start).
    #[cfg(test)]
    pub(crate) fn shutdown(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = UnixStream::connect(&self.socket);
        let _ = std::fs::remove_file(&self.socket);
    }
}

/// Binds `paths.socket` (any existing file is stale: the caller holds the instance lock) and
/// serves connections on a background thread.
pub(crate) fn start(paths: &InstancePaths, dispatch: Arc<dyn Dispatch>, cfg: ServerConfig) -> io::Result<ServerHandle> {
    paths.check_socket_len().map_err(io::Error::other)?;
    match std::fs::remove_file(&paths.socket) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let listener = UnixListener::bind(&paths.socket)?;
    std::fs::set_permissions(&paths.socket, std::fs::Permissions::from_mode(0o600))?;
    let stop = Arc::new(AtomicBool::new(false));
    let handle = ServerHandle { socket: paths.socket.clone(), stop: stop.clone() };
    std::thread::Builder::new().name("control-accept".into()).spawn(move || accept_loop(listener, dispatch, cfg, stop))?;
    Ok(handle)
}

fn accept_loop(listener: UnixListener, dispatch: Arc<dyn Dispatch>, cfg: ServerConfig, stop: Arc<AtomicBool>) {
    let live = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = stream else { continue };
        if live.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
            continue;
        }
        live.fetch_add(1, Ordering::SeqCst);
        let (dispatch, live) = (dispatch.clone(), live.clone());
        let spawned = std::thread::Builder::new().name("control-conn".into()).stack_size(512 * 1024).spawn({
            let live = live.clone();
            move || {
                serve_connection(stream, &*dispatch, cfg);
                live.fetch_sub(1, Ordering::SeqCst);
            }
        });
        if spawned.is_err() {
            live.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

fn serve_connection(stream: UnixStream, dispatch: &dyn Dispatch, cfg: ServerConfig) {
    match (cfg.peer_uid)(stream.as_raw_fd()) {
        Ok(uid) if uid == cfg.my_uid => {}
        _ => return,
    }
    let Ok(read_half) = stream.try_clone() else { return };
    let mut reader = BufReader::new(read_half);
    let mut writer = stream;
    let mut role = roles::CLI.to_string();
    loop {
        let reply = match read_frame(&mut reader, MAX_FRAME_BYTES) {
            Ok(None) | Err(FrameError::Io(_)) => return,
            Ok(Some(line)) => handle_line(&line, &mut role, dispatch),
            Err(FrameError::TooLarge) => Some(Response::err(None, RpcError::new(INVALID_REQUEST, "Message too large"))),
        };
        if let Some(r) = reply {
            if write_frame(&mut writer, &r).is_err() {
                return;
            }
        }
    }
}

/// One frame in, at most one response out (notifications get none).
pub(crate) fn handle_line(line: &[u8], role: &mut String, dispatch: &dyn Dispatch) -> Option<Response> {
    let Ok(value) = serde_json::from_slice::<Value>(line) else {
        return Some(Response::err(None, RpcError::new(PARSE_ERROR, "Parse error")));
    };
    let id = value.get("id").and_then(|v| serde_json::from_value::<Id>(v.clone()).ok());
    let request = match serde_json::from_value::<Request>(value) {
        Ok(r) if r.jsonrpc == "2.0" => r,
        _ => return Some(Response::err(id, RpcError::new(INVALID_REQUEST, "Invalid Request"))),
    };
    let result = handle_request(&request, role, dispatch);
    let id = request.id?;
    Some(match result {
        Ok(v) => Response::ok(Some(id), v),
        Err(e) => Response::err(Some(id), e),
    })
}

fn handle_request(req: &Request, role: &mut String, dispatch: &dyn Dispatch) -> Result<Value, RpcError> {
    if req.method == RPC_HELLO {
        let wanted = req.params.as_ref().and_then(|p| p.get("role")).and_then(Value::as_str);
        let Some(wanted) = wanted.filter(|r| roles::ALL.contains(r)) else {
            return Err(RpcError::invalid_params("role must be one of cli, uri, mcp"));
        };
        *role = wanted.to_string();
        return Ok(json!({"api": API_LEVEL, "role": wanted}));
    }
    // The AI interface has no master switch yet, so it is closed.
    if role == roles::MCP {
        return Err(RpcError::app(codes::NOT_PERMITTED, "The AI interface is disabled"));
    }
    let spec = methods::find(&req.method).ok_or_else(|| RpcError::method_not_found(&req.method))?;
    if !spec.roles.contains(&role.as_str()) {
        return Err(RpcError::app(codes::NOT_PERMITTED, format!("Role '{role}' may not call {}", req.method)).with("method", req.method.clone()));
    }
    dispatch.call(role, &req.method, req.params.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use vaultdraw_protocol::{CallError, Client};

    struct Fake;
    impl Dispatch for Fake {
        fn call(&self, role: &str, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
            match method {
                "app.status" => Ok(json!({"running": true, "role": role})),
                "app.open" => Ok(json!({"handled": params.and_then(|p| p["argv"].as_array().map(Vec::len)).unwrap_or(0)})),
                "command.run" => Err(RpcError::app(codes::UNAVAILABLE, "no").with("id", "x")),
                _ => Err(RpcError::method_not_found(method)),
            }
        }
    }

    struct Rig {
        _dir: tempfile::TempDir,
        paths: InstancePaths,
        handle: ServerHandle,
    }
    impl Drop for Rig {
        fn drop(&mut self) {
            self.handle.shutdown();
        }
    }

    fn rig_with(cfg: ServerConfig) -> Rig {
        let dir = tempfile::Builder::new().prefix("vd-").tempdir_in("/tmp").unwrap();
        let paths = InstancePaths::in_dir(dir.path());
        let handle = start(&paths, Arc::new(Fake), cfg).unwrap();
        Rig { _dir: dir, paths, handle }
    }
    fn rig() -> Rig {
        rig_with(ServerConfig::default())
    }

    fn raw(rig: &Rig) -> (UnixStream, BufReader<UnixStream>) {
        let s = UnixStream::connect(&rig.paths.socket).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let r = BufReader::new(s.try_clone().unwrap());
        (s, r)
    }
    fn send_line(s: &mut UnixStream, line: &str) {
        use std::io::Write;
        s.write_all(line.as_bytes()).unwrap();
        s.write_all(b"\n").unwrap();
    }
    fn recv(r: &mut BufReader<UnixStream>) -> Value {
        serde_json::from_slice(&read_frame(r, 1 << 20).unwrap().expect("reply")).unwrap()
    }

    #[test]
    fn round_trip_and_socket_mode() {
        let rig = rig();
        assert_eq!(std::fs::metadata(&rig.paths.socket).unwrap().permissions().mode() & 0o777, 0o600);
        let mut c = Client::connect(&rig.paths.socket).unwrap();
        assert_eq!(c.call("app.status", None).unwrap(), json!({"running": true, "role": "cli"}));
        let e = c.call("command.run", Some(json!({"id": "x"}))).unwrap_err();
        let CallError::Rpc(e) = e else { panic!() };
        assert_eq!(e.app_code(), Some("UNAVAILABLE"));
    }

    #[test]
    fn parse_error_invalid_request_unknown_method() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        send_line(&mut s, "{nope");
        let v = recv(&mut r);
        assert_eq!((v["error"]["code"].as_i64(), v["id"].clone()), (Some(PARSE_ERROR), Value::Null));
        send_line(&mut s, r#"{"jsonrpc":"1.0","id":4,"method":"app.status"}"#);
        let v = recv(&mut r);
        assert_eq!((v["error"]["code"].as_i64(), v["id"].clone()), (Some(INVALID_REQUEST), json!(4)));
        send_line(&mut s, r#"[1,2]"#);
        assert_eq!(recv(&mut r)["error"]["code"], INVALID_REQUEST);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":"a","method":"nope.nothing"}"#);
        let v = recv(&mut r);
        assert_eq!((v["error"]["code"].as_i64(), v["id"].clone()), (Some(vaultdraw_protocol::METHOD_NOT_FOUND), json!("a")));
    }

    #[test]
    fn notifications_get_no_reply() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        send_line(&mut s, r#"{"jsonrpc":"2.0","method":"app.status"}"#);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":9,"method":"app.status"}"#);
        assert_eq!(recv(&mut r)["id"], 9);
    }

    #[test]
    fn roles_gate_methods_and_mcp_is_closed() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        // uri may not call app.status (cli only) but may call app.open.
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":1,"method":"rpc.hello","params":{"role":"uri"}}"#);
        assert_eq!(recv(&mut r)["result"], json!({"api": 1, "role": "uri"}));
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":2,"method":"app.status"}"#);
        assert_eq!(recv(&mut r)["error"]["data"]["code"], "NOT_PERMITTED");
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":3,"method":"app.open","params":{"argv":["a","b"]}}"#);
        assert_eq!(recv(&mut r)["result"], json!({"handled": 2}));
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":4,"method":"rpc.hello","params":{"role":"root"}}"#);
        assert_eq!(recv(&mut r)["error"]["code"], vaultdraw_protocol::INVALID_PARAMS);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":5,"method":"rpc.hello","params":{"role":"mcp"}}"#);
        assert_eq!(recv(&mut r)["result"]["role"], "mcp");
        for m in ["app.status", "rpc.discover", "command.list"] {
            send_line(&mut s, &format!(r#"{{"jsonrpc":"2.0","id":6,"method":"{m}"}}"#));
            assert_eq!(recv(&mut r)["error"]["data"]["code"], "NOT_PERMITTED", "{m}");
        }
    }

    #[test]
    fn stale_socket_is_replaced() {
        let dir = tempfile::Builder::new().prefix("vd-").tempdir_in("/tmp").unwrap();
        let paths = InstancePaths::in_dir(dir.path());
        drop(UnixListener::bind(&paths.socket).unwrap()); // leaves a dead socket file
        assert!(Client::connect(&paths.socket).is_err());
        let handle = start(&paths, Arc::new(Fake), ServerConfig::default()).unwrap();
        assert!(Client::connect(&paths.socket).unwrap().call("app.status", None).is_ok());
        handle.shutdown();
    }

    #[test]
    fn other_users_are_dropped() {
        let rig = rig_with(ServerConfig { peer_uid: |_| Ok(vaultdraw_protocol::peer::my_uid() + 1), my_uid: vaultdraw_protocol::peer::my_uid() });
        let (mut s, mut r) = raw(&rig);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":1,"method":"app.status"}"#);
        assert!(read_frame(&mut r, 1 << 20).map(|f| f.is_none()).unwrap_or(true), "no reply for a foreign uid");
    }

    #[test]
    fn forward_reaches_app_open() {
        let rig = rig();
        super::super::instance::forward(&rig.paths.socket, &["vaultdraw://x".into()], Some("/tmp"), Duration::from_secs(1)).unwrap();
    }

    #[test]
    fn round_trip_latency() {
        let rig = rig();
        let mut c = Client::connect(&rig.paths.socket).unwrap();
        let mut samples = Vec::new();
        for _ in 0..500 {
            let t = Instant::now();
            c.call("app.status", None).unwrap();
            samples.push(t.elapsed());
        }
        samples.sort();
        eprintln!("app.status round trip (fake dispatcher): p50 {:?} p95 {:?}", samples[250], samples[475]);
        assert!(samples[250] < Duration::from_millis(2));
    }
}
