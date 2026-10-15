//! live_size / live_size_from_reader: tombstones, formats, ordering, garbage, reader == slice.
use super::codec_support::*;
use crate::history::codec::*;
use serde_json::{json, Value};
use std::io::Read;

/// Reader that hands out at most `chunk` bytes per call and counts what was consumed.
struct Trickle<'a> {
    data: &'a [u8],
    pos: usize,
    chunk: usize,
}
impl Read for Trickle<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.chunk.min(buf.len()).min(self.data.len() - self.pos);
        buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

fn via_reader(data: &[u8], chunk: usize) -> Option<u64> {
    live_size_from_reader(&mut Trickle { data, pos: 0, chunk }, data.len() as u64).unwrap()
}

fn all_equal(data: &[u8]) -> Option<u64> {
    let s = live_size(data);
    for chunk in [1, 2, 3, 7, 64, 4096, 1 << 20] {
        assert_eq!(via_reader(data, chunk), s, "chunk {chunk}: {}", String::from_utf8_lossy(&data[..data.len().min(200)]));
    }
    s
}

fn scene_with_tombstones(r: &mut Rng, n: usize, dead_every: usize) -> (SceneModel, usize) {
    let mut m = gen_scene(r, n, 0, 0);
    let mut dead = 0;
    for (i, e) in m.elements.iter_mut().enumerate() {
        if i % dead_every == 0 {
            e.as_object_mut().unwrap().insert("isDeleted".into(), json!(true));
            dead += 1;
        }
    }
    (m, dead)
}

fn dead_bytes(m: &SceneModel, f: impl Fn(&Value) -> usize) -> usize {
    m.elements.iter().filter(|e| e["isDeleted"] == json!(true)).map(f).sum()
}

#[test]
fn tombstones_compact_and_pretty() {
    let mut r = Rng::new(1);
    for (n, every) in [(1, 1), (10, 2), (200, 3), (200, 1), (50, 1000)] {
        let (m, _) = scene_with_tombstones(&mut r, n, every);
        let compact = render(&m, Fmt::Compact, &mut r);
        let want = compact.len() - dead_bytes(&m, |e| serde_json::to_vec(e).unwrap().len());
        assert_eq!(all_equal(&compact), Some(want as u64), "compact n={n}");
        let pretty = render(&m, Fmt::Pretty, &mut r);
        let want = pretty.len()
            - dead_bytes(&m, |e| {
                let p = serde_json::to_string_pretty(e).unwrap();
                p.len() + 4 * p.matches('\n').count()
            });
        assert_eq!(all_equal(&pretty), Some(want as u64), "pretty n={n}");
    }
    // everything deleted: live size is what's left around the elements
    let (m, _) = scene_with_tombstones(&mut r, 100, 1);
    let f = render(&m, Fmt::Compact, &mut r);
    assert!(live_size(&f).unwrap() < 300);
}

#[test]
fn unicode_and_lookalikes_are_not_tombstones() {
    let a = json!({"id":"a","text":"héllo 日本語 😀","isDeleted":true});
    let rest = [
        json!({"id":"b","text":"\"isDeleted\":true","isDeleted":false}),
        json!({"id":"c","note":"isDeleted","isDeleted":"true"}),
        json!({"id":"d","nested":{"isDeleted":true},"arr":[{"isDeleted":true}]}),
        json!({"id":"e","isDeleted":null}),
        json!({"id":"g","isDeleted":0}),
    ];
    let mut parts = vec![serde_json::to_string(&a).unwrap()];
    parts.extend(rest.iter().map(|v| serde_json::to_string(v).unwrap()));
    let file = format!("{{\"elements\":[{}],\"x\":1}}", parts.join(","));
    let want = file.len() - parts[0].len();
    assert_eq!(all_equal(file.as_bytes()), Some(want as u64));
    // whitespace variants and trailing members
    let f2 = b"{ \"elements\" : [ {\"id\":\"a\", \"isDeleted\" :\n true ,\"z\":1} , {\"id\":\"b\",\"isDeleted\":true}] }";
    let dead = "{\"id\":\"a\", \"isDeleted\" :\n true ,\"z\":1}".len() + "{\"id\":\"b\",\"isDeleted\":true}".len();
    assert_eq!(all_equal(f2), Some((f2.len() - dead) as u64));
    // key escapes are never the real key
    let f3 = br#"{"elements":[{"id":"a","\u0069sDeleted":true}]}"#;
    assert_eq!(all_equal(f3), Some(f3.len() as u64));
}

#[test]
fn files_first_and_images() {
    let mut r = Rng::new(2);
    let (mut m, _) = scene_with_tombstones(&mut r, 30, 2);
    for _ in 0..3 {
        add_image(&mut r, &mut m, 5000);
    }
    let app = render(&m, Fmt::Compact, &mut r); // elements before files
    let want = app.len() - dead_bytes(&m, |e| serde_json::to_vec(e).unwrap().len());
    assert_eq!(all_equal(&app), Some(want as u64));
    // files first: same answer for the same bytes moved around
    let els = serde_json::to_string(&m.elements).unwrap();
    let files = serde_json::to_string(&m.files).unwrap();
    let swapped = format!("{{\"files\":{files},\"appState\":{{}},\"elements\":{els}}}");
    let want = swapped.len() - dead_bytes(&m, |e| serde_json::to_vec(e).unwrap().len());
    assert_eq!(all_equal(swapped.as_bytes()), Some(want as u64));
    // elements that mention "elements" before the real one
    let tricky = format!("{{\"title\":\"elements\",\"x\":{{\"elements\":[{{\"isDeleted\":true}}]}},\"elements\":[{{\"id\":\"a\"}}]}}");
    assert_eq!(all_equal(tricky.as_bytes()), Some(tricky.len() as u64));
}

#[test]
fn reader_stops_after_elements_and_keeps_memory_flat() {
    let mut r = Rng::new(3);
    let (m, _) = scene_with_tombstones(&mut r, 100, 4);
    let mut head = serde_json::to_string(&json!({"type": "excalidraw"})).unwrap();
    head.pop();
    let els = serde_json::to_string(&m.elements).unwrap();
    // 20 MB payload after the elements: never read
    let big = "A".repeat(20 << 20);
    let file = format!("{head},\"elements\":{els},\"files\":{{\"a\":{{\"dataURL\":\"data:image/png;base64,{big}\"}}}}}}");
    let mut t = Trickle { data: file.as_bytes(), pos: 0, chunk: 1 << 20 };
    let got = live_size_from_reader(&mut t, file.len() as u64).unwrap();
    assert!(t.pos <= head.len() + els.len() + 2 * 256 * 1024 + 16, "read {} bytes", t.pos);
    let dead: usize = m.elements.iter().filter(|e| e["isDeleted"] == json!(true)).map(|e| serde_json::to_vec(e).unwrap().len()).sum();
    assert_eq!(got, Some((file.len() - dead) as u64));
    assert_eq!(live_size(file.as_bytes()), got);
    // payload first: still exact, and a payload larger than any chunk is fine
    let first = format!("{{\"files\":{{\"a\":{{\"dataURL\":\"data:image/png;base64,{big}\"}}}},\"elements\":{els}}}");
    assert_eq!(via_reader(first.as_bytes(), 1 << 18), Some((first.len() - dead) as u64));
}

#[test]
fn garbage_is_none_and_never_panics() {
    for g in [
        &b""[..],
        b"   ",
        b"garbage",
        b"[1,2,3]",
        b"}",
        b"\"str\"",
        b"{\"elements\":[{\"isDeleted\":true}",
        b"{\"a\":",
        b"{\"a\":\"unterminated",
        b"\xEF\xBB\xBF{}",
        b"\xff\xfe\x00",
        b"{\"elements\":[}]}",
    ] {
        let s = all_equal(g);
        assert!(s.is_none(), "{:?} -> {s:?}", String::from_utf8_lossy(g));
    }
    assert_eq!(all_equal(b"{}"), Some(2));
    assert_eq!(all_equal(b" {\"elements\":[]}\n"), Some(17));
    assert_eq!(all_equal(b"{\"a\":1}"), Some(7));
    // random mutations: no panic, reader == slice
    let mut r = Rng::new(7);
    let (m, _) = scene_with_tombstones(&mut r, 20, 3);
    let base = render(&m, Fmt::Hand, &mut r);
    for _ in 0..1500 {
        let mut v = base.clone();
        for _ in 0..1 + r.below(4) {
            let i = r.below(v.len());
            match r.below(3) {
                0 => v[i] = r.next() as u8,
                1 => v.truncate(i),
                _ => {
                    v.remove(i);
                }
            }
            if v.is_empty() {
                break;
            }
        }
        let chunk = 1 + r.below(300);
        assert_eq!(via_reader(&v, chunk), live_size(&v));
    }
}
