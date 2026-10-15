//! Codec bench (ignored). Run:
//! `cargo test --release --offline history::tests::codec_bench -- --ignored --nocapture`
use super::codec_support::*;
use crate::history::codec::*;
use crate::history::container::*;
use crate::history::names::UlidGen;
use std::time::Instant;

fn report(name: &str, mut ms: Vec<f64>) {
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let q = |p: f64| ms[(((ms.len() - 1) as f64) * p).round() as usize];
    let profile = std::env::var("HISTORY_PERF_PROFILE").unwrap_or_else(|_| "normal".into());
    println!(
        "HISTORY_PERF {{\"metric\":\"history.codec.{name}\",\"unit\":\"ms\",\"p50\":{:.2},\"p95\":{:.2},\"max\":{:.2},\"n\":{},\"profile\":\"{profile}\"}}",
        q(0.5),
        q(0.95),
        ms[ms.len() - 1],
        ms.len()
    );
}

fn timed<T>(f: impl FnOnce() -> T) -> (T, f64) {
    let t = Instant::now();
    let v = f();
    (v, t.elapsed().as_secs_f64() * 1000.0)
}

struct Case {
    name: &'static str,
    key_file: Vec<u8>,
    files: Vec<Vec<u8>>,
}

fn case(name: &'static str, n: usize, images: usize, img_len: usize, versions: usize) -> Case {
    let mut r = Rng::new(n as u64 + images as u64);
    let mut m = gen_scene(&mut r, n, images, img_len);
    let key_file = render(&m, Fmt::Compact, &mut r);
    let mut files = Vec::new();
    for _ in 0..versions {
        // a typical autosave interval: a handful of moves/restyles, one add
        for _ in 0..6 {
            let i = r.below(m.elements.len());
            m.elements[i].as_object_mut().unwrap().insert("x".into(), serde_json::json!(r.f()));
        }
        let el = new_element(&mut r, m.elements.len());
        m.elements.push(el);
        files.push(render(&m, Fmt::Compact, &mut r));
    }
    Case { name, key_file, files }
}

fn header_for(g: &mut UlidGen, s: &Stripped, file: &[u8], kind: &str, key: Option<&str>) -> Header {
    header(g, kind, "01JKXYZ0123456789ABCDEFGHJ", "abcdefgh", key, &s.text, file, s)
}

fn run(c: &Case, runs: usize) {
    let store = Store::default();
    let mut memo = MapMemo::default();
    let mut g = UlidGen::load(None);
    // setup: the keyframe is on disk, blobs written, memo warm (steady state of the worker)
    let ks = strip(&c.key_file, &mut memo, &|t| store.own(t), "abcdefgh", "0abc").unwrap();
    store.absorb(&ks);
    let kh = header_for(&mut g, &ks, &c.key_file, "keyframe", None);
    let key_container = write_container(&kh, &ks.text, ZSTD_LEVEL);
    println!("# {}: file {:.1} MB, stripped {:.1} MB, keyframe container {:.1} KB, {} elements", c.name, c.key_file.len() as f64 / 1e6, ks.text.len() as f64 / 1e6, key_container.len() as f64 / 1e3, ks.element_count);

    let (mut auto, mut keyframe, mut read) = (vec![], vec![], vec![]);
    let mut dsize = 0usize;
    for i in 0..runs {
        let file = &c.files[i % c.files.len()];
        // auto version: strip (memo warm) + proven delta + header + zstd-3 container
        let t = Instant::now();
        let s = strip(file, &mut memo, &|t| store.own(t), "abcdefgh", "0abc").unwrap();
        let delta = proven_delta(&ks.text, &s.text);
        let (kind, body) = match &delta {
            Some(d) => ("delta", d.as_slice()),
            None => ("keyframe", s.text.as_slice()),
        };
        let h = header_for(&mut g, &s, file, kind, delta.is_some().then_some(kh.id.as_str()));
        let out = write_container(&h, body, ZSTD_LEVEL);
        auto.push(t.elapsed().as_secs_f64() * 1000.0);
        dsize = out.len();
        assert!(delta.is_some(), "bench edit should produce a delta");

        // read path: header + body + reconstruct + inline + verify (what "read version" costs on CPU)
        let (_, ms) = timed(|| {
            let key_text = read_body(&key_container, 64 << 20).unwrap();
            let hl = header_len(&out).unwrap();
            let h2 = read_header(&out[..PREFIX_LEN + hl]).unwrap();
            let body = read_body(&out, 64 << 20).unwrap();
            let stripped = reconstruct(&key_text, Some(&body)).unwrap();
            let back = inline(&stripped, &|t| store.read(t)).unwrap();
            assert!(sha_hex(&stripped) == h2.stripped_hash && back == *file);
        });
        read.push(ms);

        // keyframe write (cold memo = first save of a drawing with new images; warm = otherwise)
        let (_, ms) = timed(|| {
            let s = strip(file, &mut memo, &|t| store.own(t), "abcdefgh", "0abc").unwrap();
            let h = header_for(&mut g, &s, file, "keyframe", None);
            write_container(&h, &s.text, ZSTD_LEVEL)
        });
        keyframe.push(ms);
    }
    println!("# {}: delta container {:.1} KB", c.name, dsize as f64 / 1e3);
    report(&format!("write_auto.{}", c.name), auto);
    report(&format!("write_keyframe.{}", c.name), keyframe);
    report(&format!("read_version.{}", c.name), read);
    // live size for the shrink rule: slice, and streamed from a reader (stops after `elements`)
    if c.name == "5k" || c.name == "5kimg" {
        let file = &c.files[0];
        let mut live = vec![];
        for _ in 0..runs.max(30) {
            let (v, ms) = timed(|| {
                live_size_from_reader(&mut std::io::Cursor::new(file.as_slice()), file.len() as u64).unwrap()
            });
            assert!(v.is_some());
            live.push(ms);
        }
        report(&format!("liveSize.{}", c.name), live);
        let mut live = vec![];
        for _ in 0..runs.max(30) {
            let (v, ms) = timed(|| live_size(file));
            assert!(v.is_some());
            live.push(ms);
        }
        report(&format!("liveSize.slice.{}", c.name), live);
    }
    // cold first-time strip (hash + decode every image, memo empty, nothing on disk)
    if c.name.contains("img") {
        let mut cold = vec![];
        for _ in 0..runs.min(8) {
            let (_, ms) = timed(|| strip(&c.key_file, &mut MapMemo::default(), &|_| false, "abcdefgh", "0abc").unwrap());
            cold.push(ms);
        }
        report(&format!("strip_cold.{}", c.name), cold);
    }
}

#[test]
#[ignore]
fn codec_bench() {
    let runs: usize = std::env::var("HISTORY_BENCH_RUNS").ok().and_then(|v| v.parse().ok()).unwrap_or(30);
    for c in [
        case("200", 200, 0, 0, 8),
        case("2k", 2000, 0, 0, 8),
        case("5k", 5000, 0, 0, 8),
        // about 20 MB of base64 (incl. stripped payloads) over 5k elements
        case("5kimg", 5000, 12, 1_400_000, 8),
    ] {
        run(&c, runs);
    }
}
