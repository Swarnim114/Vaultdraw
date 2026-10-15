//! Regression tests from the H1 codec review.
use super::codec_support::*;
use crate::history::codec::*;
use crate::history::container::*;
use crate::history::names::UlidGen;

fn strip_plain(file: &[u8]) -> Stripped {
    strip(file, &mut NoMemo, &|_| false, &dev(), &epoch()).unwrap()
}

/// A file the scanner cannot walk (not JSON) that contains a literal token-looking string must
/// still survive strip then inline byte for byte.
#[test]
fn unscannable_file_with_literal_token_round_trips() {
    let sha = "a".repeat(64);
    for file in [
        format!("not json @vdblob:{sha}.png tail").into_bytes(),
        b"[ @vdblob:@vdblob: ]".to_vec(),
        format!("{{\"elements\": [}} @vdblob:{sha}.png").into_bytes(),
    ] {
        let s = strip_plain(&file);
        let back = inline(&s.text, &|_| panic!("literal must not be fetched as a blob"));
        assert_eq!(back.unwrap(), file, "{}", String::from_utf8_lossy(&file));
    }
}

/// A memo that maps (id, len, crc) to the wrong token must not make us store bytes under a
/// sha they don't hash to.
#[test]
fn stale_memo_cannot_poison_the_blob_store() {
    let payload = b64(b"hello image bytes");
    let file = format!(
        r#"{{"type":"excalidraw","elements":[],"files":{{"f1":{{"id":"f1","dataURL":"data:image/png;base64,{payload}"}}}}}}"#
    )
    .into_bytes();
    let mut memo = MapMemo::default();
    let bogus = format!("{}.png", "b".repeat(64));
    memo.0.insert(("f1".into(), payload.len(), crc32fast::hash(payload.as_bytes())), bogus);
    let s = strip(&file, &mut memo, &|_| false, &dev(), &epoch()).unwrap();
    let store = Store::default();
    store.absorb(&s);
    assert_eq!(inline(&s.text, &|t| store.read(t)).unwrap(), file);
}

/// A drawing with many images has a long `blobs` list; the header must still read back.
#[test]
fn header_with_many_blobs_reads_back() {
    let mut gen = UlidGen::load(None);
    let mut rng = Rng::new(7);
    let s = Stripped { text: vec![], blobs: vec![], new_blobs: vec![], element_count: 0 };
    let lineage = gen.next(1_739_539_200_000);
    let mut h = header(&mut gen, "keyframe", &lineage, &dev(), None, b"x", b"x", &s);
    h.blobs = (0..1500).map(|i| format!("{}.png", sha_hex(format!("{i}{}", rng.next()).as_bytes()))).collect();
    let bytes = write_container(&h, b"body", ZSTD_LEVEL);
    let len = header_len(&bytes).unwrap();
    assert!(len <= MAX_HEADER_BYTES);
    assert_eq!(read_header(&bytes[..PREFIX_LEN + len]).unwrap().blobs, h.blobs);
}
