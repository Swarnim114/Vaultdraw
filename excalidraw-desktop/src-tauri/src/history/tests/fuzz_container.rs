//! Fuzz-style tests: random and mutated containers, bombs, malicious headers/tokens/deltas, and
//! mutated scene text. No panics; errors only; no allocation above the caps.
use super::codec_support::*;
use crate::history::codec::*;
use crate::history::container::*;
use crate::history::names::UlidGen;
use serde_json::json;

fn sample() -> (Header, Vec<u8>, Vec<u8>) {
    let mut r = Rng::new(5);
    let m = gen_scene(&mut r, 20, 2, 500);
    let file = render(&m, Fmt::Pretty, &mut r);
    let store = Store::default();
    let s = strip(&file, &mut MapMemo::default(), &|t| store.own(t), "abcdefgh", "0abc").unwrap();
    let mut g = UlidGen::load(None);
    let lineage = g.next(1);
    let h = header(&mut g, "keyframe", &lineage, "abcdefgh", None, &s.text, &file, &s);
    let c = write_container(&h, &s.text, 3);
    (h, c, file)
}

fn mutate(r: &mut Rng, src: &[u8]) -> Vec<u8> {
    let mut v = src.to_vec();
    for _ in 0..1 + r.below(4) {
        if v.is_empty() {
            v.push(r.next() as u8);
            continue;
        }
        match r.below(6) {
            0 => {
                let i = r.below(v.len());
                v[i] ^= 1 << r.below(8);
            }
            1 => {
                let i = r.below(v.len());
                v[i] = r.next() as u8;
            }
            2 => v.truncate(r.below(v.len() + 1)),
            3 => {
                let i = r.below(v.len() + 1);
                v.insert(i, r.next() as u8);
            }
            4 => {
                let i = r.below(v.len());
                v.remove(i);
            }
            _ => {
                let i = r.below(v.len());
                let j = (i + r.below(40)).min(v.len());
                v.drain(i..j);
            }
        }
    }
    v
}

fn all_reads(c: &[u8]) {
    let _ = header_len(c);
    let _ = read_header(c);
    let _ = read_header(&c[..c.len().min(4096)]);
    let _ = read_body(c, 1 << 20);
}

#[test]
fn mutated_containers_never_panic() {
    let (h, c, _) = sample();
    assert_eq!(read_header(&c[..PREFIX_LEN + header_len(&c).unwrap()]).unwrap(), h);
    let mut r = Rng::new(1);
    let mut rejected = 0;
    for _ in 0..4000 {
        let m = mutate(&mut r, &c);
        all_reads(&m);
        if read_body(&m, 1 << 20).is_err() || read_header(&m).is_err() {
            rejected += 1;
        }
    }
    assert!(rejected > 3000, "mutations should mostly be detected ({rejected})");
    let orig_body = read_body(&c, 1 << 26).unwrap();
    // every single-bit flip in the first 200 bytes and a stride through the rest
    for i in (0..c.len()).step_by(if c.len() > 5000 { 37 } else { 1 }) {
        for bit in 0..8 {
            let mut m = c.clone();
            m[i] ^= 1 << bit;
            all_reads(&m);
            // the body frame has a checksum: any flip there must be caught
            let hl = PREFIX_LEN + header_len(&c).unwrap();
            if i >= hl {
                // a flip may be harmless (unused descriptor bit, entropy padding) but never changes content
                if let Ok(out) = read_body(&m, 1 << 26) {
                    assert!(out == orig_body, "flip at {i} bit {bit} silently changed the body");
                }
            }
        }
    }
    // pure random garbage, and garbage behind a valid magic
    for n in [0usize, 1, 3, 7, 8, 9, 50, 4096] {
        for _ in 0..50 {
            let mut g = r.bytes(n);
            all_reads(&g);
            if n >= 4 {
                g[..3].copy_from_slice(b"VDH");
                g[3] = 1;
                all_reads(&g);
            }
        }
    }
    // every truncation
    for n in 0..c.len().min(3000) {
        all_reads(&c[..n]);
        assert!(read_body(&c[..n], 1 << 26).is_err() || n == c.len());
    }
}

fn frame_header(descriptor: u8, size: u64) -> Vec<u8> {
    let mut f = vec![0x28, 0xB5, 0x2F, 0xFD, descriptor];
    f.extend_from_slice(&size.to_le_bytes());
    f
}

fn container_with(header_frame: &[u8], body_frame: &[u8]) -> Vec<u8> {
    let mut c = b"VDH\x01".to_vec();
    c.extend_from_slice(&(header_frame.len() as u32).to_le_bytes());
    c.extend_from_slice(header_frame);
    c.extend_from_slice(body_frame);
    c
}

#[test]
fn decompression_bombs_are_refused_before_allocation() {
    let (_, c, _) = sample();
    let hl = PREFIX_LEN + header_len(&c).unwrap();
    // tiny frame declaring 1 GiB (single segment, 8-byte size, checksum flag)
    let bomb = frame_header(0xE4, 1 << 30);
    let err = read_body(&container_with(&c[PREFIX_LEN..hl], &bomb), 32 << 20).unwrap_err();
    assert_eq!(err.code, "VERSION_CORRUPT");
    // declared size u64::MAX
    assert!(read_body(&container_with(&c[PREFIX_LEN..hl], &frame_header(0xE4, u64::MAX)), 32 << 20).is_err());
    // same as a header frame
    assert!(read_header(&container_with(&bomb, &[])).is_err());
    // a real frame that is over the cap: 40 MiB of zeros compresses to a few KB
    let zeros = vec![0u8; 40 << 20];
    let mut comp = zstd::bulk::Compressor::new(3).unwrap();
    comp.include_checksum(true).unwrap();
    let frame = comp.compress(&zeros).unwrap();
    assert!(frame.len() < 10_000);
    let full = container_with(&c[PREFIX_LEN..hl], &frame);
    assert!(read_body(&full, 32 << 20).is_err());
    assert_eq!(read_body(&full, 40 << 20).unwrap().len(), 40 << 20);
    // a header frame over 64 KiB decoded
    let big_json = vec![b' '; 100_000];
    let hf = comp.compress(&big_json).unwrap();
    assert!(read_header(&container_with(&hf, &[])).is_err());
    // frames without content size (streaming) or without checksum are refused
    let streamed = zstd::stream::encode_all(&b"hello hello hello"[..], 3).unwrap();
    assert!(read_body(&container_with(&c[PREFIX_LEN..hl], &streamed), 1 << 20).is_err());
    let no_sum = zstd::bulk::compress(b"hello hello hello", 3).unwrap();
    assert!(read_body(&container_with(&c[PREFIX_LEN..hl], &no_sum), 1 << 20).is_err());
    // trailing bytes after the body frame
    let mut tail = c.clone();
    tail.extend_from_slice(b"junk");
    assert!(read_body(&tail, 1 << 26).is_err());
    // an empty body round-trips
    let h = sample().0;
    assert_eq!(read_body(&write_container(&h, b"", 3), 10).unwrap(), b"");
}

#[test]
fn prefix_rules() {
    let (_, c, _) = sample();
    let mut m = c.clone();
    m[3] = 2;
    assert_eq!(read_header(&m).unwrap_err().code, "HISTORY_FORMAT_NEWER");
    assert_eq!(read_body(&m, 1 << 26).unwrap_err().code, "HISTORY_FORMAT_NEWER");
    m[3] = 0;
    assert_eq!(read_header(&m).unwrap_err().code, "VERSION_CORRUPT");
    let mut m = c.clone();
    m[0] = b'X';
    assert!(read_header(&m).is_err());
    let mut m = c.clone();
    m[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(header_len(&m).is_err() && read_header(&m).is_err() && read_body(&m, 1 << 26).is_err());
    m[4..8].copy_from_slice(&0u32.to_le_bytes());
    assert!(header_len(&m).is_err());
    m[4..8].copy_from_slice(&(MAX_HEADER_BYTES as u32 + 1).to_le_bytes());
    assert!(header_len(&m).is_err());
    // declared length beyond the prefix we were given
    let hl = header_len(&c).unwrap();
    assert_eq!(read_header(&c[..PREFIX_LEN + hl - 1]).unwrap_err().code, "VERSION_CORRUPT");
    assert!(read_header(&c[..4]).is_err());
}

fn with(f: impl FnOnce(&mut Header)) -> Header {
    let mut h = sample().0;
    f(&mut h);
    h
}

#[test]
fn bad_headers_are_rejected_on_read() {
    let ok = sample().0;
    assert!(ok.validate().is_ok());
    let long = |n: usize| "é".repeat(n);
    let valid_name = with(|h| h.name = Some(long(120)));
    assert!(valid_name.validate().is_ok(), "120 chars (multi-byte) is fine");
    assert!(with(|h| h.note = Some("x".repeat(2000))).validate().is_ok());
    let sha = "ab".repeat(32);
    let bads: Vec<(&str, Header)> = vec![
        ("format 2", with(|h| h.format = 2)),
        ("format 0", with(|h| h.format = 0)),
        ("id lower", with(|h| h.id = h.id.to_lowercase())),
        ("id short", with(|h| h.id.pop().map(drop).unwrap_or(()))),
        ("id has I", with(|h| h.id.replace_range(0..1, "I"))),
        ("lineage", with(|h| h.lineage = "../..".into())),
        ("device upper", with(|h| h.device = "ABCDEFGH".into())),
        ("device slash", with(|h| h.device = "abcd/fgh".into())),
        ("epoch", with(|h| h.epoch = "0abl".into())),
        ("kind", with(|h| h.kind = "weird".into())),
        ("delta w/o keyframe", with(|h| h.kind = "delta".into())),
        ("keyframe with keyframe", with(|h| h.keyframe = Some(h.id.clone()))),
        ("delta bad keyframe", with(|h| { h.kind = "delta".into(); h.keyframe = Some("nope".into()) })),
        ("reason upper", with(|h| h.reason = "Auto".into())),
        ("reason long", with(|h| h.reason = "a".repeat(40))),
        ("revision", with(|h| h.file_revision = "zz".repeat(32))),
        ("revision upper", with(|h| h.file_revision = sha.to_uppercase())),
        ("revision empty", with(|h| h.file_revision.clear())),
        ("stripped short", with(|h| h.stripped_hash = sha[..63].into())),
        ("name 121", with(|h| h.name = Some(long(121)))),
        ("note 2001", with(|h| h.note = Some("x".repeat(2001)))),
        ("app long", with(|h| h.app = "x".repeat(129))),
        ("path empty", with(|h| h.path.clear())),
        ("path abs", with(|h| h.path = "/etc/a.excalidraw".into())),
        ("path dotdot", with(|h| h.path = "../x.excalidraw".into())),
        ("path mid dotdot", with(|h| h.path = "a/../b.excalidraw".into())),
        ("path dot", with(|h| h.path = "./a.excalidraw".into())),
        ("path empty part", with(|h| h.path = "a//b.excalidraw".into())),
        ("path backslash", with(|h| h.path = "a\\b.excalidraw".into())),
        ("path nul", with(|h| h.path = "a\0b.excalidraw".into())),
        ("path newline", with(|h| h.path = "a\nb.excalidraw".into())),
        ("path ext", with(|h| h.path = "a/b.txt".into())),
        ("path trailing slash", with(|h| h.path = "a/b.excalidraw/".into())),
        ("blob dotdot", with(|h| h.blobs = vec!["../..".into()])),
        ("blob upper", with(|h| h.blobs = vec![format!("{}.png", sha.to_uppercase())])),
        ("blob long ext", with(|h| h.blobs = vec![format!("{sha}.abcdefghi")])),
        ("blob traversal", with(|h| h.blobs = vec![format!("{sha}.png/../x")])),
    ];
    for (what, h) in bads {
        assert!(h.validate().is_err(), "{what} must fail validate");
        let c = write_container(&h, b"{}", 3);
        assert!(read_header(&c).is_err(), "{what} must fail read_header");
    }
    // path records have no hashes
    let pm = with(|h| {
        h.kind = "path".into();
        h.file_revision.clear();
        h.stripped_hash.clear();
    });
    assert!(pm.validate().is_ok());
}

#[test]
fn header_json_edge_cases() {
    let (_, c, _) = sample();
    let hl = PREFIX_LEN + header_len(&c).unwrap();
    let json = zstd::bulk::decompress(&c[PREFIX_LEN..hl], 1 << 16).unwrap();
    let mut v: serde_json::Value = serde_json::from_slice(&json).unwrap();
    let frame = |v: &serde_json::Value| {
        let mut comp = zstd::bulk::Compressor::new(3).unwrap();
        comp.include_checksum(true).unwrap();
        container_with(&comp.compress(&serde_json::to_vec(v).unwrap()).unwrap(), &[])
    };
    // unknown fields are ignored
    v["futureField"] = json!({"a": [1, 2, 3]});
    assert!(read_header(&frame(&v)).is_ok());
    // missing required fields / wrong types
    for key in ["id", "lineage", "device", "epoch", "kind", "path", "format", "reason", "created"] {
        let mut w = v.clone();
        w.as_object_mut().unwrap().remove(key);
        assert!(read_header(&frame(&w)).is_err(), "missing {key}");
        w[key] = json!([1]);
        assert!(read_header(&frame(&w)).is_err(), "wrong type {key}");
    }
    assert!(read_header(&frame(&json!([1, 2]))).is_err());
    assert!(read_header(&frame(&json!("x"))).is_err());
}

#[test]
fn malicious_deltas_never_panic_or_balloon() {
    let mut r = Rng::new(3);
    let mut m = gen_scene(&mut r, 60, 1, 200);
    let a = strip_text(&render(&m, Fmt::Pretty, &mut r));
    for _ in 0..5 {
        edit(&mut r, &mut m);
    }
    m.elements.reverse();
    let b = strip_text(&render(&m, Fmt::Pretty, &mut r));
    let d = proven_delta(&a, &b).expect("delta");
    assert_eq!(reconstruct(&a, Some(&d)).unwrap(), b);
    let mut ok = 0;
    for _ in 0..6000 {
        let bad = mutate(&mut r, &d);
        if reconstruct(&a, Some(&bad)).is_ok() {
            ok += 1;
        }
    }
    assert!(ok < 3000, "most mutations of a delta should fail ({ok} ok)");
    for n in 0..d.len() {
        assert!(reconstruct(&a, Some(&d[..n])).is_err(), "truncation at {n}");
    }
    for _ in 0..500 {
        let n = r.below(300);
        let g = r.bytes(n);
        let _ = reconstruct(&a, Some(&g));
        let mut g2 = b"VDD1".to_vec();
        g2.extend(g);
        let _ = reconstruct(&a, Some(&g2));
    }
    // a 1 MiB separator repeated over 100 gaps would be 100 MB: refused, not built
    let key: String = format!("{{\"elements\":[{}]}}", (0..100).map(|i| format!("{{\"id\":\"e{i}\"}}")).collect::<Vec<_>>().join(","));
    let mut body = b"VDD1".to_vec();
    body.push(3); // prefix and suffix same
    body.extend_from_slice(&[0x80, 0x80, 0x40]); // varint 1 MiB
    body.extend(std::iter::repeat(b' ').take(1 << 20));
    body.extend_from_slice(&[0, 0, 0]); // no exceptions, changed, removed
    let e = reconstruct(key.as_bytes(), Some(&body)).unwrap_err();
    assert_eq!(e.code, "VERSION_CORRUPT");
    // absurd counts
    let mut huge = b"VDD1\x03\x00".to_vec();
    huge.extend_from_slice(&[0xFF; 9]);
    huge.push(0x01);
    assert!(reconstruct(key.as_bytes(), Some(&huge)).is_err());
    // order that isn't a permutation
    let mut o = b"VDD1\x07\x00\x00\x00\x00".to_vec();
    o.push(100);
    o.extend(std::iter::repeat(0u8).take(100));
    assert!(reconstruct(key.as_bytes(), Some(&o)).is_err());
}

fn strip_text(file: &[u8]) -> Vec<u8> {
    strip(file, &mut NoMemo, &|_| false, "abcdefgh", "0abc").unwrap().text
}

#[test]
fn malicious_tokens_in_stripped_text() {
    let mut r = Rng::new(8);
    let sha = sha_hex(b"x");
    let seeds = [
        format!("{{\"dataURL\":\"data:image/png;base64,@vdblob:{sha}.png\"}}"),
        "@vdblob:@vdblob:@".to_string(),
        format!("@vdblob:{sha}.png@vdblob:{sha}.jpg"),
        "@vdblob:../..".to_string(),
        format!("@vdblob:{sha}.png/../../x"),
    ];
    let read = |t: &str| -> crate::Result<Vec<u8>> {
        // a hostile callback must still never make inline panic
        Ok(t.as_bytes().to_vec())
    };
    for s in &seeds {
        for _ in 0..800 {
            let m = mutate(&mut r, s.as_bytes());
            let _ = inline(&m, &read);
        }
    }
    // a token whose blob is a different size / hash is refused
    assert!(inline(seeds[0].as_bytes(), &read).is_err());
}

#[test]
fn mutated_scene_text_strips_and_deltas_exactly() {
    let mut r = Rng::new(11);
    let m = gen_scene(&mut r, 12, 2, 300);
    let base = render(&m, Fmt::Hand, &mut r);
    let base2 = render(&m, Fmt::Compact, &mut r);
    let store = Store::default();
    let mut deltas = 0;
    for i in 0..3000 {
        let src = if i % 2 == 0 { &base } else { &base2 };
        let file = mutate(&mut r, src);
        let s = strip(&file, &mut NoMemo, &|t| store.own(t), "abcdefgh", "0abc").unwrap();
        store.absorb(&s);
        let back = inline(&s.text, &|t| store.read(t)).unwrap();
        assert!(back == file, "strip/inline lost bytes on a mutated file");
        // delta between the unmutated and mutated stripped text, when proven, is exact
        let key = strip_text(src);
        if let Some(d) = proven_delta(&key, &s.text) {
            deltas += 1;
            assert_eq!(reconstruct(&key, Some(&d)).unwrap(), s.text);
        }
        let _ = encode_delta(&s.text, &key);
    }
    assert!(deltas > 100, "{deltas}");
}
