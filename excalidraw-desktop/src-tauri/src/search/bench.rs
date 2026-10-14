//! Realistic 5,000-drawing benchmark (ignored by default):
//! `cargo test --release bench_5k -- --ignored --nocapture`
//! Optionally under `taskpolicy -c background` for the low-end profile.

use super::*;
use std::{fs, path::Path, time::Duration};

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + self.below(hi - lo + 1)
    }
}

const WORDS: &[&str] = &[
    "service", "database", "client", "server", "gateway", "queue", "cache", "worker", "auth", "token", "user", "order", "payment", "invoice", "report", "dashboard", "graph", "node", "edge", "tree", "heap", "stack", "array", "sort", "search", "index", "query", "schema", "table", "column", "migration", "deploy", "pipeline", "build", "test", "release", "rollback", "monitor", "alert", "metric", "latency", "throughput", "retry", "timeout", "backoff", "circuit", "breaker", "sidecar", "proxy", "ingress", "egress", "cluster", "pod", "container", "volume", "secret", "config", "feature", "flag", "experiment", "metrics", "design", "review", "sprint", "backlog", "epic", "story", "roadmap", "milestone", "risk", "owner", "team", "meeting", "agenda", "notes", "todo", "idea", "question", "answer", "decision", "option", "pros", "cons", "cost", "budget", "estimate", "dijkstra", "shortest", "path", "kruskal", "prim", "bellman", "ford", "topological", "dynamic", "programming", "recursion", "memoization", "binary", "hash", "collision", "bucket", "flow", "state", "machine", "event", "stream", "batch", "window", "join", "shuffle", "partition", "replica", "leader", "follower", "consensus", "raft", "paxos", "quorum", "cafe", "resume", "naive", "über", "straße", "école", "niño",
];

const CJK: &[&str] = &["数据库设计", "服务认证流程", "用户登录", "支付网关", "消息队列", "缓存策略", "系统架构图", "データベース", "カフェメニュー", "ひらがな", "한국어 문서", "검색 기능"];

const FOLDERS: &[&str] = &["Work", "Personal", "DSA", "Systems", "Ideas", "Archive", "Meetings", "Design", "Research", "Learning"];

fn sentence(r: &mut Rng, n: usize) -> String {
    (0..n).map(|_| WORDS[r.below(WORDS.len())]).collect::<Vec<_>>().join(" ")
}

fn make_drawing(r: &mut Rng, blob: Option<&str>) -> String {
    let n_text = r.range(5, 60);
    let mut els: Vec<String> = Vec::new();
    for i in 0..n_text {
        let words = r.range(1, 8);
        let mut t = sentence(r, words);
        if r.below(40) == 0 {
            t = CJK[r.below(CJK.len())].to_string();
        }
        if r.below(25) == 0 {
            t = sentence(r, 60); // a paragraph
        }
        if r.below(3) == 0 {
            // bound label: container + wrapped text vs originalText
            els.push(format!(r#"{{"id":"box{i}","type":"rectangle","x":10.5,"y":20.25,"width":120,"height":60,"isDeleted":false,"boundElements":[{{"id":"t{i}","type":"text"}}]}}"#));
            let wrapped = t.replace(' ', "\\n");
            els.push(format!(r#"{{"id":"t{i}","type":"text","containerId":"box{i}","text":"{wrapped}","originalText":"{t}","x":12,"y":22,"width":100,"height":20,"isDeleted":false}}"#));
        } else {
            els.push(format!(r#"{{"id":"t{i}","type":"text","text":"{t}","originalText":"{t}","x":1.5,"y":2.5,"width":100,"height":20,"isDeleted":{}}}"#, r.below(15) == 0));
        }
        if r.below(4) == 0 {
            els.push(format!(r#"{{"id":"a{i}","type":"arrow","x":0,"y":0,"points":[[0,0],[100,50]],"isDeleted":false}}"#));
        }
    }
    for f in 0..r.below(4) {
        els.push(format!(r#"{{"id":"frame{f}","type":"frame","name":"{}","x":0,"y":0,"width":500,"height":400,"isDeleted":false}}"#, sentence(r, 2)));
    }
    let files = match blob {
        Some(b) => format!(r#"{{"file1":{{"mimeType":"image/png","id":"file1","dataURL":"data:image/png;base64,{b}","created":1}}}}"#),
        None => "{}".into(),
    };
    format!(r##"{{"type":"excalidraw","version":2,"source":"bench","elements":[{}],"appState":{{"viewBackgroundColor":"#ffffff"}},"files":{files}}}"##, els.join(","))
}

fn generate(root: &Path) -> (usize, usize) {
    let mut r = Rng(0x9E3779B97F4A7C15);
    let blob_small = "iVBORw0KGgo".repeat(1_100_000 / 11); // ~1.1 MB
    let blob_big = "iVBORw0KGgo".repeat(2_000_000 / 11); // ~2 MB
    let (mut bytes, mut with_blob) = (0usize, 0usize);
    let past = std::time::SystemTime::now() - Duration::from_secs(6 * 3600);
    for d in 0..5000 {
        let blob = if d % 10 == 3 {
            with_blob += 1;
            Some(if d % 20 == 3 { blob_big.as_str() } else { blob_small.as_str() })
        } else {
            None
        };
        let json = make_drawing(&mut r, blob);
        bytes += json.len();
        let top = FOLDERS[r.below(FOLDERS.len())];
        let sub = r.below(20);
        let title = if d % 40 == 0 { CJK[r.below(CJK.len())].to_string() } else { sentence(&mut r, 2) };
        let rel = format!("{top}/sub{sub}/{title} {d}.excalidraw");
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, json).unwrap();
        fs::OpenOptions::new().write(true).open(&p).unwrap().set_modified(past).unwrap();
    }
    (bytes, with_blob)
}

fn rss_mb() -> f64 {
    std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map_or(0.0, |kb| kb / 1024.0)
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() as f64 * p).ceil() as usize).saturating_sub(1).min(sorted.len() - 1)]
}

fn wait_ready(svc: &SearchService) -> Option<Duration> {
    let t = Instant::now();
    let mut names_ready = None;
    loop {
        let s = svc.status("h").unwrap();
        if names_ready.is_none() && s.total == 5000 {
            names_ready = Some(t.elapsed());
        }
        if s.state == IndexState::Ready {
            return names_ready;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
#[ignore]
fn bench_5k() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let snap = dir.path().join("state/index/0123456789abcdef/index.bin");
    let t = Instant::now();
    let (json_bytes, with_blob) = generate(&root);
    let disk: u64 = walk_size(&root);
    println!("generated 5000 drawings in {:.1}s: {:.0} MB on disk ({} with 1-2 MB image blobs), JSON text {:.0} MB", t.elapsed().as_secs_f64(), disk as f64 / 1e6, with_blob, json_bytes as f64 / 1e6);

    // ---- cold build
    let rss0 = rss_mb();
    let svc = SearchService::default();
    let t = Instant::now();
    svc.start_with("h", root.clone(), Arc::new(|_| {}), Some(snap.clone()));
    let names_ready = wait_ready(&svc);
    let cold = t.elapsed();
    let st = svc.status("h").unwrap();
    assert_eq!((st.indexed, st.total), (5000, 5000));
    let t2 = Instant::now();
    while !snap.exists() && t2.elapsed() < Duration::from_secs(30) {
        std::thread::sleep(Duration::from_millis(10));
    }
    let heap = svc.with_index("h", |i| i.approx_heap_bytes()).unwrap();
    let snap_bytes = fs::metadata(&snap).map(|m| m.len()).unwrap_or(0);
    let rss1 = rss_mb();

    // ---- queries
    let queries: Vec<(&str, &str)> = vec![
        ("single letter", "a"), ("single letter", "e"), ("single letter", "s"), ("single letter", "x"), ("single letter", "q"),
        ("prefix typing", "d"), ("prefix typing", "di"), ("prefix typing", "dij"), ("prefix typing", "dijk"), ("prefix typing", "dijks"), ("prefix typing", "dijkstra"),
        ("prefix typing", "gr"), ("prefix typing", "gra"), ("prefix typing", "grap"), ("prefix typing", "graph"),
        ("common word", "service"), ("common word", "the"), ("common word", "node"), ("common word", "auth"),
        ("multi-term", "dijkstra graph"), ("multi-term", "auth service flow"), ("multi-term", "shortest path dijkstra"), ("multi-term", "database migration deploy"),
        ("cjk", "数据库"), ("cjk", "认证"), ("cjk", "设计 流程"), ("cjk", "かふぇ"), ("cjk", "한국어"),
        ("accent", "cafe"), ("accent", "strasse"), ("accent", "ecole"),
        ("no match", "zzzzqq"), ("no match", "qqqqxx yy"), ("no match", "dijkstra zzzzqq"),
        ("file name", "sub7"), ("file name", "work"),
    ];
    let mut rows = Vec::new();
    let mut worst95: f64 = 0.0;
    for (kind, q) in &queries {
        let mut times = Vec::new();
        let mut total = 0;
        for _ in 0..20 {
            let t = Instant::now();
            let r = svc.search("h", q, None, None).unwrap();
            times.push(t.elapsed().as_secs_f64() * 1000.0);
            total = r.total_matches;
        }
        times.sort_by(f64::total_cmp);
        worst95 = worst95.max(pct(&times, 0.95));
        rows.push((*kind, *q, total, pct(&times, 0.5), pct(&times, 0.95), *times.last().unwrap()));
    }
    // scope=names (quick switcher)
    for q in ["a", "work", "design 1"] {
        let mut times = Vec::new();
        let mut total = 0;
        for _ in 0..20 {
            let t = Instant::now();
            total = svc.search("h", q, None, Some("names")).unwrap().total_matches;
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        rows.push(("names scope", q, total, pct(&times, 0.5), pct(&times, 0.95), *times.last().unwrap()));
    }
    svc.stop("h");
    std::thread::sleep(Duration::from_millis(300));

    // ---- warm start (snapshot older than every file's mtime? no: files are OLDER than the snapshot)
    let t = Instant::now();
    let warm_svc = SearchService::default();
    warm_svc.start_with("h", root.clone(), Arc::new(|_| {}), Some(snap.clone()));
    wait_ready(&warm_svc);
    let warm = t.elapsed();
    let st = warm_svc.status("h").unwrap();
    assert_eq!((st.indexed, st.total), (5000, 5000));
    let hits = warm_svc.search("h", "dijkstra", None, None).unwrap().total_matches;

    println!("\n=== bench_5k ===");
    println!("cold build to ready          : {:>8.0} ms  (all 5000 names searchable after {:?})", cold.as_secs_f64() * 1000.0, names_ready);
    println!("warm start (load + stat walk): {:>8.0} ms  (dijkstra matches {hits})", warm.as_secs_f64() * 1000.0);
    println!("index heap (approx)          : {:>8.1} MB", heap as f64 / 1e6);
    println!("snapshot size                : {:>8.1} MB", snap_bytes as f64 / 1e6);
    println!("process RSS before/after cold: {rss0:.0} / {rss1:.0} MB (test binary, includes allocator slack)");
    println!("\n{:<14} {:<26} {:>8} {:>9} {:>9} {:>9}", "kind", "query", "matches", "p50 ms", "p95 ms", "max ms");
    for (kind, q, total, p50, p95, max) in &rows {
        println!("{kind:<14} {q:<26} {total:>8} {p50:>9.3} {p95:>9.3} {max:>9.3}");
    }
    let all_p95: Vec<f64> = rows.iter().map(|r| r.4).collect();
    println!("\nworst per-query p95: {worst95:.3} ms over {} queries x 20 runs (budget 50 ms)   mean p95 {:.3} ms", rows.len(), all_p95.iter().sum::<f64>() / all_p95.len() as f64);
    assert!(worst95 < 50.0, "query p95 budget broken: {worst95}");
}

fn walk_size(root: &Path) -> u64 {
    super::worker::walk(root, "").iter().map(|f| f.size).sum()
}
