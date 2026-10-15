//! Codec property tests (500 seeds of the edit model) and hand-written fixtures. Every version
//! goes strip -> keyframe or proven delta -> container -> read -> reconstruct -> inline and must
//! come back byte-exact.
use super::codec_support::*;
use crate::history::codec::*;
use crate::history::container::*;
use crate::history::names::UlidGen;

const CAP: usize = 64 * 1024 * 1024;

#[derive(Default, Debug)]
pub struct Stats {
    pub keyframes: usize,
    pub deltas: usize,
}

/// Runs a lineage of exact file versions through the whole write + read pipeline.
pub fn roundtrip_versions(files: &[Vec<u8>]) -> Stats {
    let store = Store::default();
    let mut memo = MapMemo::default();
    let mut gen = UlidGen::load(None);
    let (dev, lineage) = (dev(), gen.next(1_700_000_000_000));
    let mut stats = Stats::default();
    // the latest keyframe as it sits on disk: (id, container bytes)
    let mut key: Option<(String, Vec<u8>)> = None;
    for file in files {
        let s = strip(file, &mut memo, &|t| store.own(t), &epoch_dev().0, &epoch_dev().1).expect("strip");
        store.absorb(&s);
        let key_text = key.as_ref().map(|(_, c)| read_body(c, CAP).expect("keyframe body"));
        let delta = key_text
            .as_deref()
            .and_then(|k| proven_delta(k, &s.text))
            .filter(|d| !delta_too_big(d.len(), s.text.len()));
        let (kind, body, key_id) = match (&delta, &key) {
            (Some(d), Some((kid, _))) => ("delta", d.clone(), Some(kid.clone())),
            _ => ("keyframe", s.text.clone(), None),
        };
        let h = header(&mut gen, kind, &lineage, &dev, key_id.as_deref(), &s.text, file, &s);
        let container = write_container(&h, &body, 3);
        // read back through the public API only
        let hl = header_len(&container).expect("header_len");
        let h2 = read_header(&container[..PREFIX_LEN + hl]).expect("read_header");
        assert_eq!(h2, h);
        let body2 = read_body(&container, CAP).expect("read_body");
        let stripped = if kind == "delta" {
            let kt = key_text.as_deref().expect("key text");
            stats.deltas += 1;
            reconstruct(kt, Some(&body2)).expect("reconstruct")
        } else {
            stats.keyframes += 1;
            reconstruct(&body2, None).expect("reconstruct keyframe")
        };
        assert_eq!(sha_hex(&stripped), h2.stripped_hash);
        let back = inline(&stripped, &|t| store.read(t)).expect("inline");
        assert!(back == *file, "inline() differs from the original file");
        assert_eq!(sha_hex(&back), h2.file_revision);
        if kind == "keyframe" {
            key = Some((h.id.clone(), container));
        }
    }
    stats
}

fn epoch_dev() -> (String, String) {
    thread_local! { static D: (String, String) = (dev(), epoch()); }
    D.with(|d| (d.0.clone(), d.1.clone()))
}

#[test]
fn property_500_seeds() {
    let (mut keys, mut deltas) = (0, 0);
    for seed in 0..500u64 {
        let mut r = Rng::new(seed);
        let n = 3 + r.below(40);
        let imgs = r.below(4);
        let len = 100 + r.below(3000);
        let mut m = gen_scene(&mut r, n, imgs, len);
        m.with_files_key = seed % 11 != 0;
        let mixed = seed % 7 == 0;
        let base = [Fmt::Compact, Fmt::Pretty, Fmt::Hand, Fmt::HandEscaped][(seed % 4) as usize];
        let mut files = Vec::new();
        for _ in 0..(10 + r.below(5)) {
            let fmt = if mixed { [Fmt::Compact, Fmt::Pretty, Fmt::Hand, Fmt::HandEscaped][r.below(4)] } else { base };
            files.push(render(&m, fmt, &mut r));
            for _ in 0..1 + r.below(3) {
                edit(&mut r, &mut m);
            }
        }
        let st = roundtrip_versions(&files);
        // Hand-formatted variants randomise whitespace on every save, so every element differs;
        // only the stable formats are expected to produce mostly deltas.
        if !mixed && seed % 4 < 2 {
            keys += st.keyframes;
            deltas += st.deltas;
        }
    }
    eprintln!("property: {keys} keyframes, {deltas} deltas");
    assert!(deltas > keys, "deltas should dominate for small edits ({deltas} vs {keys})");
}

fn strip_plain(file: &[u8]) -> Stripped {
    strip(file, &mut NoMemo, &|_| false, "abcdefgh", "0abc").expect("strip")
}

fn scene(elements: &str, files: Option<&str>) -> Vec<u8> {
    match files {
        Some(f) => format!("{{\"type\":\"excalidraw\",\"elements\":{elements},\"appState\":{{}},\"files\":{f}}}"),
        None => format!("{{\"type\":\"excalidraw\",\"elements\":{elements},\"appState\":{{}}}}"),
    }
    .into_bytes()
}

fn exact(file: &[u8]) -> Stripped {
    let store = Store::default();
    let s = strip(file, &mut NoMemo, &|_| false, "abcdefgh", "0abc").expect("strip");
    store.absorb(&s);
    let back = inline(&s.text, &|t| store.read(t)).expect("inline");
    assert!(back == file, "not exact: {}", String::from_utf8_lossy(file));
    roundtrip_versions(&[file.to_vec(), file.to_vec()]);
    s
}

#[test]
fn fixture_slash_and_plus_payloads() {
    // 0xFB 0xEF 0xBE encodes to "++++"; 0xFF 0xFF 0xFF to "////".
    let bytes = [0xFBu8, 0xEF, 0xBE, 0xFF, 0xFF, 0xFF, 0xFB, 0xFF];
    let p = b64(&bytes);
    assert!(p.contains('+') && p.contains('/'));
    let f = format!(r#"{{"a":{{"id":"a","mimeType":"image/png","dataURL":"data:image/png;base64,{p}"}}}}"#);
    let s = exact(&scene("[]", Some(&f)));
    assert_eq!(s.blobs.len(), 1);
    assert!(s.blobs[0].ends_with(".png"));
    assert_eq!(s.new_blobs[0].bytes, bytes);
    assert!(!String::from_utf8_lossy(&s.text).contains(&p));
    // `\/` escaped payload must stay inline (Minor 12)
    let esc = p.replace('/', "\\/");
    let f = format!(r#"{{"a":{{"dataURL":"data:image/png;base64,{esc}"}}}}"#);
    let s = exact(&scene("[]", Some(&f)));
    assert!(s.blobs.is_empty());
    // `+` for '+' too
    let esc = p.replace('+', "\\u002b");
    let f = format!(r#"{{"a":{{"dataURL":"data:image/png;base64,{esc}"}}}}"#);
    assert!(exact(&scene("[]", Some(&f))).blobs.is_empty());
}

#[test]
fn fixture_non_base64_data_urls_stay_inline() {
    for url in [
        "data:image/png;base64,@@@@",
        "data:text/plain,hello",
        "notadataurl",
        "data:image/png;base64,QUJD=",
        "data:image/png;base64,QR==", // non-canonical trailing bits
        "data:image/png;base64,QUJ", // bad length
        "data:image/png;base64,QU JD",
        "data:image/png;base64,\u{e9}UJD",
        "data:image/png;base64,",
        "data:image/png;base64,====",
        "data:image/png;base64,QUJD\nQUJD",
        "data:image/png;base64,QUJDQUJD=QUJD",
        "data:image/png;base64",
        "",
    ] {
        let f = format!(r#"{{"a":{{"dataURL":"{}"}}}}"#, url.replace('\n', "\\n"));
        let s = exact(&scene("[]", Some(&f)));
        assert!(s.blobs.is_empty(), "{url:?} must not be stripped");
    }
    // non-string dataURL values and odd shapes
    for f in [r#"{"a":{"dataURL":null}}"#, r#"{"a":{"dataURL":12}}"#, r#"{"a":5}"#, r#"{"a":[]}"#, "{}", "null", r#"{"a":{"dataURL":{"x":"data:image/png;base64,QUJD"}}}"#] {
        exact(&scene("[]", Some(f)));
    }
}

#[test]
fn fixture_valid_payload_variants() {
    let f = r#"{"a":{"dataURL":"data:image/png;base64,QUJD"},"b":{"dataURL":"data:image/jpeg;base64,QQ=="},"c":{"dataURL":"data:image/svg+xml;base64,QUI="},"d":{"dataURL":"data:application/x-foo;base64,QUJD"},"e":{"dataURL":"data:image/png;base64,QUJD"}}"#;
    let s = exact(&scene("[]", Some(f)));
    let exts: Vec<&str> = s.blobs.iter().map(|b| b.rsplit('.').next().unwrap()).collect();
    assert_eq!(exts, ["png", "jpg", "svg", "bin"]); // "e" duplicates "a": deduplicated
    assert_eq!(s.new_blobs.len(), 4);
    for b in &s.new_blobs {
        assert!(crate::history::names::BlobName::parse(&b.file).is_some(), "{}", b.file);
    }
}

#[test]
fn fixture_missing_files_key_and_empty_scene() {
    for file in [
        scene("[]", None),
        scene("[ ]", Some("{}")),
        b"{\"elements\":[]}".to_vec(),
        b"{}".to_vec(),
        b"{\"elements\":[],\"files\":{}}".to_vec(),
        b"{\n  \"elements\": [\n  ],\n  \"files\": {\n  }\n}\n".to_vec(),
        b"{\"files\":{\"a\":{\"dataURL\":\"data:image/png;base64,QUJD\"}},\"elements\":[{\"id\":\"x\"}]}".to_vec(),
        Vec::new(),
        b"not json at all".to_vec(),
        b"\xEF\xBB\xBF{\"elements\":[]}".to_vec(),
        vec![0xFF, 0xFE, 0x00],
        b"[1,2,3]".to_vec(),
        b"{\"elements\":[{\"id\":\"x\"}".to_vec(), // truncated
    ] {
        exact(&file);
    }
    assert_eq!(strip_plain(&scene("[]", None)).element_count, 0);
    assert_eq!(strip_plain(&scene("[{\"id\":\"a\"},{\"id\":\"b\"}]", None)).element_count, 2);
    assert_eq!(strip_plain(b"garbage").text, b"garbage");
}

#[test]
fn fixture_duplicate_ids_fall_back_to_keyframes() {
    let a = scene(r#"[{"id":"x","v":1},{"id":"x","v":2},{"id":"y"}]"#, None);
    let b = scene(r#"[{"id":"x","v":1},{"id":"x","v":3},{"id":"y"}]"#, None);
    assert!(encode_delta(&a, &b).is_none());
    assert!(proven_delta(&a, &b).is_none());
    let ok = scene(r#"[{"id":"x"},{"id":"y"}]"#, None);
    assert!(encode_delta(&ok, &b).is_none(), "duplicate ids in the new text");
    assert!(encode_delta(&b, &ok).is_none(), "duplicate ids in the key text");
    let st = roundtrip_versions(&[a, b, ok]);
    assert_eq!(st.deltas, 0);
}

#[test]
fn fixture_literal_token_text_is_escaped() {
    let tok = format!("@vdblob:{}.png", "a".repeat(64));
    for text in [
        "@vdblob:".to_string(),
        "@vdblob:@".to_string(),
        "@vdblob:@vdblob:".to_string(),
        "@vdblob:vdblob:".to_string(),
        tok.clone(),
        format!("x {tok} y {tok}"),
        "@vdblob:../..".to_string(),
    ] {
        let els = format!(r#"[{{"id":"t","text":"{text}"}}]"#);
        let f = scene(&els, Some(r#"{"a":{"dataURL":"data:image/png;base64,QUJD"}}"#));
        let s = exact(&f);
        assert_eq!(s.blobs.len(), 1);
        // the literal text must not look like a token to `inline`
        assert!(!String::from_utf8_lossy(&s.text).contains(&format!("{tok}\"")) || text.contains(&tok));
    }
}

#[test]
fn memo_and_own_copy_rules() {
    let f = scene("[]", Some(r#"{"a":{"dataURL":"data:image/png;base64,QUJDREVG"},"b":{"dataURL":"data:image/png;base64,QUJDREVG"}}"#));
    let mut memo = MapMemo::default();
    let s1 = strip(&f, &mut memo, &|_| false, "abcdefgh", "0abc").unwrap();
    assert_eq!(s1.new_blobs.len(), 1, "same bytes under two file ids: one blob");
    assert_eq!(memo.0.len(), 2);
    // memo hit and own copy exists: nothing to write, same text
    let s2 = strip(&f, &mut memo, &|_| true, "abcdefgh", "0abc").unwrap();
    assert!(s2.new_blobs.is_empty());
    assert_eq!(s1.text, s2.text);
    assert_eq!(s1.blobs, s2.blobs);
    // memo hit but this epoch has no copy yet: the bytes are emitted again
    let s3 = strip(&f, &mut memo, &|_| false, "abcdefgh", "0abd").unwrap();
    assert_eq!(s3.new_blobs.len(), 1);
    assert!(s3.new_blobs[0].file.ends_with("-abcdefgh-0abd.png"));
    assert_eq!(s3.new_blobs[0].bytes, b"ABCDEF");
    // a poisoned memo entry with a malformed value is ignored
    let mut bad = MapMemo::default();
    let crc = crc32fast::hash(b"QUJDREVG");
    bad.remember("a", 8, crc, "../../etc/passwd");
    let s4 = strip(&f, &mut bad, &|_| false, "abcdefgh", "0abc").unwrap();
    assert_eq!(s4.text, s1.text);
    // bad dev / epoch are refused before any name is built
    assert!(strip(&f, &mut NoMemo, &|_| false, "ABCDEFGH", "0abc").is_err());
    assert!(strip(&f, &mut NoMemo, &|_| false, "abcdefgh", "../..").is_err());
}

#[test]
fn inline_rejects_bad_blobs_and_tokens() {
    let sha = sha_hex(b"hello");
    let text = |t: &str| format!("{{\"dataURL\":\"data:image/png;base64,@vdblob:{t}\"}}").into_bytes();
    let good = |_: &str| Ok(b"hello".to_vec());
    assert!(inline(&text(&format!("{sha}.png")), &good).is_ok());
    // content does not match the sha
    let wrong = |_: &str| Ok(b"hellp".to_vec());
    assert_eq!(inline(&text(&format!("{sha}.png")), &wrong).unwrap_err().code, "VERSION_CORRUPT");
    // missing blob: the callback's error is passed through
    let missing = |_: &str| Err(crate::err("VERSION_CORRUPT", "gone"));
    assert!(inline(&text(&format!("{sha}.png")), &missing).is_err());
    let never = |t: &str| -> crate::Result<Vec<u8>> { panic!("callback must not run for {t}") };
    for bad in ["../..", "", &"a".repeat(63), &format!("{}.png", "A".repeat(64)), &format!("{sha}.PNG"), &format!("{sha}."), &format!("{sha}.toolongext1"), &format!("{sha}"), "..%2f"] {
        assert!(inline(&text(bad), &never).is_err(), "{bad:?}");
    }
    // no tokens: unchanged
    assert_eq!(inline(b"plain text", &never).unwrap(), b"plain text");
}

#[test]
fn delta_is_small_and_exact_for_one_edit() {
    let mut r = Rng::new(99);
    for fmt in [Fmt::Compact, Fmt::Pretty] {
        let mut m = gen_scene(&mut r, 2000, 0, 0);
        let a = render(&m, fmt, &mut Rng::new(1));
        m.elements[1000].as_object_mut().unwrap().insert("x".into(), serde_json::json!(5.5));
        let b = render(&m, fmt, &mut Rng::new(1));
        let sa = strip_plain(&a);
        let sb = strip_plain(&b);
        let d = proven_delta(&sa.text, &sb.text).expect("delta");
        assert!(d.len() < 2000, "{fmt:?}: delta of one edit is {} bytes", d.len());
        assert_eq!(reconstruct(&sa.text, Some(&d)).unwrap(), sb.text);
        // identical text: tiny delta
        let same = proven_delta(&sa.text, &sa.text).unwrap();
        assert!(same.len() < 40);
    }
    assert!(delta_too_big(26, 100) && !delta_too_big(25, 100));
}

#[test]
fn delta_handles_irregular_separators_and_reorders() {
    let a = b"{\"elements\":[{\"id\":\"a\",\"n\":1} ,\n {\"id\":\"b\"},{\"id\":\"c\"}\t,{\"id\":\"d\"}],\"x\":1}".to_vec();
    let b = b"{\"elements\":[ {\"id\":\"d\"},{\"id\":\"a\",\"n\":2}\n,\n{\"id\":\"e\"} , {\"id\":\"c\"}  ] ,\"x\":2}".to_vec();
    let d = proven_delta(&a, &b).expect("delta with exceptions");
    assert_eq!(reconstruct(&a, Some(&d)).unwrap(), b);
    // to/from an empty array
    let e = b"{\"elements\": [ ],\"x\":1}".to_vec();
    for (k, n) in [(&a, &e), (&e, &a), (&e, &e)] {
        let d = proven_delta(k, n).expect("delta");
        assert_eq!(reconstruct(k, Some(&d)).unwrap(), *n);
    }
    // not sliceable: no elements key, trailing comma, element without id, non-object element
    for bad in [&b"{}"[..], b"{\"elements\":[{\"id\":\"a\"},]}", b"{\"elements\":[{\"x\":1}]}", b"{\"elements\":[1]}", b"{\"elements\":{}}", b"{\"elements\":[],\"elements\":[]}"] {
        assert!(encode_delta(bad, &a).is_none() && encode_delta(&a, bad).is_none(), "{}", String::from_utf8_lossy(bad));
    }
    assert!(reconstruct(&a, None).unwrap() == a);
    assert!(reconstruct(b"{}", Some(b"VDD1\x03")).is_err());
}
