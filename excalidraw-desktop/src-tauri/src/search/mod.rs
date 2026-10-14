//! Vault-wide search of drawing names and the text inside drawings (F1).
//!
//! In-memory index of normalised text per drawing, scanned linearly with
//! `memchr::memmem`; built and kept current by a background worker per open vault.

mod extract;
mod index;
mod normalize;
mod store;
mod types;
mod worker;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod bench;

// Public API for other features (tags, quick switcher); unused until they land.
#[allow(unused_imports)]
pub(crate) use extract::{extract_items, ItemKind, TextItem};
pub(crate) use index::Index;
#[allow(unused_imports)]
pub(crate) use normalize::{normalize, NORMALIZER_VERSION};
#[allow(unused_imports)]
pub(crate) use types::{ElementMatch, IndexState, IndexStatus, Scope, SearchHit, SearchResponse};

use crate::{err, Result};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::AtomicBool, mpsc, Arc, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard},
    time::Instant,
};
use tauri::{AppHandle, Emitter as _, State};

const MAX_QUERY_CHARS: usize = 256;
const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 200;

/// Receives every status change (and throttled progress while building).
pub(crate) type Emitter = Arc<dyn Fn(IndexStatus) + Send + Sync>;

pub(crate) enum Update {
    /// Vault-relative paths reported by the file watcher (files or folders, possibly gone).
    Paths(Vec<String>),
    Rescan,
    Shutdown,
}

pub(crate) struct VaultIndex {
    index: RwLock<Index>,
    state: Mutex<IndexState>,
    tx: mpsc::Sender<Update>,
    stop: AtomicBool,
}

impl VaultIndex {
    fn read(&self) -> RwLockReadGuard<'_, Index> {
        self.index.read().unwrap_or_else(|p| p.into_inner())
    }
    fn write(&self) -> RwLockWriteGuard<'_, Index> {
        self.index.write().unwrap_or_else(|p| p.into_inner())
    }
    fn set_state(&self, state: IndexState) {
        *self.state.lock().unwrap_or_else(|p| p.into_inner()) = state;
    }
    fn status(&self, handle: &str) -> IndexStatus {
        let state = *self.state.lock().unwrap_or_else(|p| p.into_inner());
        let (indexed, total) = self.read().counts();
        IndexStatus { handle: handle.to_string(), state, indexed: indexed as u32, total: total as u32 }
    }
}

#[derive(Default)]
pub(crate) struct SearchService {
    vaults: Mutex<HashMap<String, Arc<VaultIndex>>>,
}

/// Emits `search-index-status` to the webview.
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn tauri_emitter(app: &AppHandle) -> Emitter {
    let app = app.clone();
    Arc::new(move |status| {
        let _ = app.emit("search-index-status", status);
    })
}

impl SearchService {
    fn vault(&self, handle: &str) -> Result<Arc<VaultIndex>> {
        self.vaults
            .lock()
            .map_err(|_| err("INTERNAL", "Search state unavailable"))?
            .get(handle)
            .cloned()
            .ok_or_else(|| err("NOT_FOUND", "Unknown vault"))
    }

    /// Starts indexing `root` (canonical vault path) with the snapshot in the machine state dir.
    #[cfg_attr(test, allow(dead_code))]
    pub(crate) fn start(&self, handle: &str, root: PathBuf, emit: Emitter) {
        let snapshot = crate::config::resolve_dirs().ok().map(|d| store::snapshot_path(&d.state, &root));
        self.start_with(handle, root, emit, snapshot);
    }

    pub(crate) fn start_with(&self, handle: &str, root: PathBuf, emit: Emitter, snapshot: Option<PathBuf>) {
        let (tx, rx) = mpsc::channel();
        let shared = Arc::new(VaultIndex { index: RwLock::new(Index::default()), state: Mutex::new(IndexState::Loading), tx, stop: AtomicBool::new(false) });
        let worker = worker::Worker { handle: handle.to_string(), root, shared: shared.clone(), rx, emit, snapshot, last_emit: Instant::now(), dirty_since: None };
        if let Err(e) = std::thread::Builder::new().name("vaultdraw-search".into()).spawn(move || worker.run()) {
            eprintln!("vaultdraw: search indexer not started: {e}");
            return;
        }
        if let Ok(mut vaults) = self.vaults.lock() {
            if let Some(old) = vaults.insert(handle.to_string(), shared) {
                Self::shut_down(&old);
            }
        }
    }

    fn shut_down(v: &VaultIndex) {
        v.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = v.tx.send(Update::Shutdown);
    }

    /// Forwards watcher results; `paths` are vault-relative, `rescan` forces a full resync.
    pub(crate) fn notify(&self, handle: &str, paths: &[String], rescan: bool) {
        let Ok(v) = self.vault(handle) else { return };
        if rescan {
            let _ = v.tx.send(Update::Rescan);
        }
        if !paths.is_empty() {
            let _ = v.tx.send(Update::Paths(paths.to_vec()));
        }
    }

    pub(crate) fn stop(&self, handle: &str) {
        if let Some(v) = self.vaults.lock().ok().and_then(|mut m| m.remove(handle)) {
            Self::shut_down(&v);
        }
    }

    #[allow(dead_code)] // API for the tags feature
    /// Runs `f` over the live index (e.g. tag extraction via `Index::for_each_item`).
    pub(crate) fn with_index<T>(&self, handle: &str, f: impl FnOnce(&Index) -> T) -> Option<T> {
        let v = self.vault(handle).ok()?;
        let index = v.read();
        Some(f(&index))
    }

    pub(crate) fn status(&self, handle: &str) -> Result<IndexStatus> {
        Ok(self.vault(handle)?.status(handle))
    }

    pub(crate) fn search(&self, handle: &str, query: &str, limit: Option<u32>, scope: Option<&str>) -> Result<SearchResponse> {
        if query.chars().count() > MAX_QUERY_CHARS {
            return Err(err("INVALID_QUERY", format!("Query is longer than {MAX_QUERY_CHARS} characters")));
        }
        let scope = Scope::parse(scope).ok_or_else(|| err("INVALID_SCOPE", "Scope must be all, names or content"))?;
        let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize;
        let v = self.vault(handle)?;
        let started = Instant::now();
        let (results, total) = v.read().query(query, scope, limit);
        let took_ms = (started.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0;
        Ok(SearchResponse { query: query.to_string(), results, total_matches: total as u32, status: v.status(handle), took_ms })
    }
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn search_vault(handle: String, query: String, limit: Option<u32>, scope: Option<String>, state: State<'_, SearchService>) -> Result<SearchResponse> {
    state.search(&handle, &query, limit, scope.as_deref())
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn search_index_status(handle: String, state: State<'_, SearchService>) -> Result<IndexStatus> {
    state.status(&handle)
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use std::{fs, path::Path, time::Duration};

    fn noop() -> Emitter {
        Arc::new(|_| {})
    }

    fn drawing(texts: &[&str]) -> String {
        let els: Vec<String> = texts
            .iter()
            .enumerate()
            .map(|(i, t)| format!(r#"{{"id":"e{i}","type":"text","text":{t:?},"originalText":{t:?},"isDeleted":false}}"#))
            .collect();
        format!(r#"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{}},"files":{{}}}}"#, els.join(","))
    }

    fn write(root: &Path, rel: &str, texts: &[&str]) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, drawing(texts)).unwrap();
    }

    fn wait_until(what: &str, mut cond: impl FnMut() -> bool) {
        for _ in 0..400 {
            if cond() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("timed out waiting for {what}");
    }

    fn paths(svc: &SearchService, q: &str) -> Vec<String> {
        svc.search("h", q, None, None).unwrap().results.into_iter().map(|h| h.path).collect()
    }

    fn started(root: &Path) -> SearchService {
        let svc = SearchService::default();
        svc.start_with("h", root.to_path_buf(), noop(), None);
        wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        svc
    }

    #[test]
    fn cold_build_indexes_names_and_content_skipping_junk() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "a.excalidraw", &["Alpha"]);
        write(root, "sub/b.excalidraw", &["Beta"]);
        write(root, ".excalidraw-vault/hidden.excalidraw", &["Secret"]);
        fs::write(root.join("note.txt"), "alpha").unwrap();
        fs::write(root.join("broken.excalidraw"), "not json").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("a.excalidraw"), root.join("link.excalidraw")).unwrap();
        let svc = started(root);
        assert_eq!(paths(&svc, "alpha"), vec!["a.excalidraw"]);
        assert_eq!(paths(&svc, "secret"), Vec::<String>::new());
        assert_eq!(paths(&svc, "broken"), vec!["broken.excalidraw"]);
        assert_eq!(paths(&svc, "link"), Vec::<String>::new());
        let st = svc.status("h").unwrap();
        assert_eq!((st.indexed, st.total), (3, 3));
    }

    #[test]
    fn watcher_updates_add_change_delete_and_folder_rename() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "a.excalidraw", &["alpha"]);
        let svc = started(root);

        write(root, "b.excalidraw", &["bravo"]);
        svc.notify("h", &["b.excalidraw".into()], false);
        wait_until("bravo", || paths(&svc, "bravo") == ["b.excalidraw"]);

        write(root, "a.excalidraw", &["charlie is longer now"]);
        svc.notify("h", &["a.excalidraw".into()], false);
        wait_until("charlie", || paths(&svc, "charlie") == ["a.excalidraw"]);
        assert!(paths(&svc, "alpha").is_empty());

        fs::remove_file(root.join("a.excalidraw")).unwrap();
        svc.notify("h", &["a.excalidraw".into()], false);
        wait_until("a removed", || paths(&svc, "charlie").is_empty());

        write(root, "f/c.excalidraw", &["delta"]);
        svc.notify("h", &["f".into(), "f/c.excalidraw".into()], false);
        wait_until("delta", || paths(&svc, "delta") == ["f/c.excalidraw"]);
        fs::rename(root.join("f"), root.join("g")).unwrap();
        svc.notify("h", &["f".into(), "g".into()], false);
        wait_until("renamed folder", || paths(&svc, "delta") == ["g/c.excalidraw"]);

        fs::remove_dir_all(root.join("g")).unwrap();
        svc.notify("h", &["g".into()], false);
        wait_until("folder removed", || paths(&svc, "delta").is_empty());

        write(root, "late.excalidraw", &["echo"]);
        svc.notify("h", &[], true);
        wait_until("rescan", || paths(&svc, "echo") == ["late.excalidraw"]);
    }

    #[test]
    fn snapshot_is_written_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let snap = dir.path().join("state/index.bin");
        write(&root, "a.excalidraw", &["alpha"]);
        let svc = SearchService::default();
        svc.start_with("h", root.clone(), noop(), Some(snap.clone()));
        wait_until("snapshot", || snap.exists());
        svc.stop("h");
        assert!(svc.status("h").is_err());

        let again = SearchService::default();
        again.start_with("h", root.clone(), noop(), Some(snap));
        wait_until("ready", || again.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        assert_eq!(again.search("h", "alpha", None, None).unwrap().total_matches, 1);
    }

    #[test]
    fn emits_status_ending_in_ready() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["alpha"]);
        let seen: Arc<Mutex<Vec<IndexStatus>>> = Arc::default();
        let sink = seen.clone();
        let svc = SearchService::default();
        svc.start_with("h", dir.path().to_path_buf(), Arc::new(move |s| sink.lock().unwrap().push(s)), None);
        wait_until("ready event", || seen.lock().unwrap().last().is_some_and(|s| s.state == IndexState::Ready));
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].state, IndexState::Loading);
        assert_eq!(seen.last().unwrap().indexed, 1);
    }

    #[test]
    fn search_validates_arguments() {
        let dir = tempfile::tempdir().unwrap();
        let svc = started(dir.path());
        assert_eq!(svc.search("h", &"x".repeat(257), None, None).unwrap_err().code, "INVALID_QUERY");
        assert_eq!(svc.search("h", "x", None, Some("bogus")).unwrap_err().code, "INVALID_SCOPE");
        assert_eq!(svc.search("nope", "x", None, None).unwrap_err().code, "NOT_FOUND");
        assert!(svc.search("h", "x", Some(0), Some("names")).is_ok());
    }

    #[test]
    fn response_serialises_to_the_frozen_contract() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["Alpha"]);
        let svc = started(dir.path());
        let v = serde_json::to_value(svc.search("h", "alp", None, None).unwrap()).unwrap();
        assert_eq!(v["totalMatches"], 1);
        assert_eq!(v["status"]["state"], "ready");
        let hit = &v["results"][0];
        assert_eq!(hit["nameHighlights"], serde_json::json!([]));
        let m = &hit["matches"][0];
        assert_eq!(m["kind"], "text");
        assert!(m["containerId"].is_null());
        assert_eq!(m["highlights"], serde_json::json!([[0, 3]]));
        assert!(v["tookMs"].is_number());
    }

    #[test]
    fn with_index_exposes_items_for_tags() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["#todo one", "two"]);
        let svc = started(dir.path());
        let n = svc.with_index("h", |idx| {
            let mut n = 0;
            idx.for_each_item(|_, _| n += 1);
            n
        });
        assert_eq!(n, Some(2));
    }

    /// Synthetic 5k-drawing vault: `cargo test --release search::unit_tests::perf -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn perf_5k_drawings() {
        let mut seed = 0x9E3779B97F4A7C15u64;
        let mut rnd = move |n: usize| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % n as u64) as usize
        };
        const SYL: [&str; 24] = ["ka", "to", "ri", "me", "su", "al", "be", "con", "der", "ing", "ex", "pa", "lo", "ver", "tin", "dat", "ser", "vice", "base", "auth", "flow", "node", "api", "the"];
        let vocab: Vec<String> = (0..3000).map(|_| (0..1 + rnd(3)).map(|_| SYL[rnd(SYL.len())]).collect::<String>()).collect();
        let word = |rnd: &mut dyn FnMut(usize) -> usize| {
            // Zipf-ish: low indices are far more common.
            let a = rnd(vocab.len());
            let b = rnd(vocab.len());
            vocab[a.min(b)].clone()
        };
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let mut json_total = 0usize;
        for d in 0..5000 {
            let mut els = Vec::new();
            for i in 0..20 {
                let n = 2 + rnd(3);
                let t: Vec<String> = (0..n).map(|_| word(&mut rnd)).collect();
                els.push(format!(r#"{{"id":"t{i}","type":"text","text":"{0}","originalText":"{0}","x":1.5,"y":2.5,"width":10,"height":20}},{{"id":"r{i}","type":"rectangle","x":0,"y":0,"points":[[0,0],[1,1]]}}"#, t.join(" ")));
            }
            for l in 0..2 {
                let t: Vec<String> = (0..150).map(|_| word(&mut rnd)).collect();
                els.push(format!(r#"{{"id":"long{l}","type":"text","text":"{0}","originalText":"{0}"}}"#, t.join(" ")));
            }
            if d % 10 == 0 {
                els.push(r#"{"id":"cjk","type":"text","text":"数据库设计与服务认证流程","originalText":"数据库设计与服务认证流程"}"#.into());
            }
            let files = if d % 50 == 0 { format!(r#""files":{{"f":{{"dataURL":"data:image/png;base64,{}"}}}}"#, "A".repeat(200_000)) } else { r#""files":{}"#.into() };
            let json = format!(r#"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{}},{files}}}"#, els.join(","));
            json_total += json.len();
            let p = root.join(format!("folder{}/drawing-{d}-{}.excalidraw", d % 40, word(&mut rnd)));
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, json).unwrap();
        }
        println!("vault: 5000 drawings, {:.1} MB of JSON", json_total as f64 / 1e6);

        let snap = dir.path().join("state/index.bin");
        let svc = SearchService::default();
        let t = Instant::now();
        svc.start_with("h", root.clone(), noop(), Some(snap.clone()));
        let mut names_ready = None;
        while svc.status("h").unwrap().state != IndexState::Ready {
            if names_ready.is_none() && svc.status("h").unwrap().total == 5000 {
                names_ready = Some(t.elapsed());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        println!("cold build: {:?} (all names searchable after {:?})", t.elapsed(), names_ready);
        std::thread::sleep(Duration::from_millis(100));
        let heap = svc.with_index("h", |i| i.approx_heap_bytes()).unwrap();
        println!("index heap estimate: {:.1} MB, snapshot {:.1} MB", heap as f64 / 1e6, fs::metadata(&snap).unwrap().len() as f64 / 1e6);

        for q in ["the", "auth", "serv", "kato", "database design", "数据库", "zzzz", "a", "drawing-12", "dat flow api"] {
            let mut times: Vec<f64> = (0..200).map(|_| svc.search("h", q, None, None).unwrap().took_ms).collect();
            times.sort_by(f64::total_cmp);
            let r = svc.search("h", q, None, None).unwrap();
            println!("query {q:?}: {} matches, p50 {:.2} ms p95 {:.2} ms", r.total_matches, times[100], times[190]);
        }
        svc.stop("h");

        let t = Instant::now();
        let (_, idx) = store::load(&snap).unwrap();
        println!("snapshot load: {:?} ({} docs)", t.elapsed(), idx.counts().1);
        let t = Instant::now();
        let again = SearchService::default();
        again.start_with("h", root, noop(), Some(snap));
        while again.status("h").unwrap().state != IndexState::Ready {
            std::thread::sleep(Duration::from_millis(2));
        }
        println!("warm start to ready (load + stat walk): {:?}", t.elapsed());
    }
}
