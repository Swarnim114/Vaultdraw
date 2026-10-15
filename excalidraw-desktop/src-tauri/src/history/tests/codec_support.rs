//! Shared test helpers: PRNG, scene generator, edit model, formatting variants, an independent
//! base64 encoder (so the tests don't use the code under test as their oracle), blob store.
use crate::history::codec::{BlobMemo, Stripped};
use crate::history::container::Header;
use crate::history::names::{epoch_code, random_crockford_lower, UlidGen};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::HashMap;

pub struct Rng(pub u64);
impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03)
    }
    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next() % n as u64) as usize
        }
    }
    pub fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
    pub fn f(&mut self) -> f64 {
        (self.next() % 1_000_000) as f64 / 100.0
    }
    pub fn bytes(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| self.next() as u8).collect()
    }
    pub fn id(&mut self) -> String {
        const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
        (0..21).map(|_| A[self.below(A.len())] as char).collect()
    }
}

pub fn b64(data: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(A[(n >> 18) as usize & 63] as char);
        s.push(A[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    s
}

pub fn sha_hex(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(b))
}

const WORDS: &[&str] = &[
    "héllo",
    "日本語",
    "😀 emoji",
    "quote\" here",
    "back\\slash",
    "tab\there",
    "line\nbreak",
    "@mention",
    "a/b/c",
    "plain",
    "ünïcödé",
    "𝔘𝔫𝔦",
];

pub fn rand_text(r: &mut Rng) -> String {
    (0..1 + r.below(4)).map(|_| WORDS[r.below(WORDS.len())]).collect::<Vec<_>>().join(" ")
}

pub fn new_element(r: &mut Rng, idx: usize) -> Value {
    let kind = ["rectangle", "ellipse", "arrow", "text", "line", "diamond"][r.below(6)];
    let mut m = json!({
        "id": r.id(), "type": kind, "x": r.f(), "y": r.f(), "width": r.f(), "height": r.f(), "angle": 0,
        "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2,
        "roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, "index": format!("a{idx:x}"),
        "seed": r.below(1 << 30), "version": 3, "versionNonce": r.below(1 << 30), "isDeleted": false,
        "boundElements": null, "updated": 1739539200000u64 + idx as u64, "link": null, "locked": false,
    });
    let o = m.as_object_mut().unwrap();
    if kind == "text" {
        o.insert("text".into(), json!(rand_text(r)));
        o.insert("fontSize".into(), json!(20));
    }
    if kind == "arrow" || kind == "line" {
        let pts: Vec<Value> = (0..2 + r.below(18)).map(|_| json!([r.f(), r.f()])).collect();
        o.insert("points".into(), Value::Array(pts));
    }
    m
}

#[derive(Clone)]
pub struct SceneModel {
    pub elements: Vec<Value>,
    pub files: Map<String, Value>,
    pub app_state: Value,
    pub with_files_key: bool,
}

fn make_file(r: &mut Rng, id: &str, len: usize) -> Value {
    let mime = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "application/x-weird"][r.below(5)];
    let data = r.bytes(len);
    json!({"mimeType": mime, "id": id, "dataURL": format!("data:{mime};base64,{}", b64(&data)), "created": 1739539200000u64, "lastRetrieved": 1739539200000u64})
}

pub fn add_image(r: &mut Rng, m: &mut SceneModel, img_len: usize) {
    let fid = r.id();
    m.files.insert(fid.clone(), make_file(r, &fid, img_len));
    let mut el = new_element(r, m.elements.len());
    let o = el.as_object_mut().unwrap();
    o.insert("type".into(), json!("image"));
    o.insert("fileId".into(), json!(fid));
    m.elements.push(el);
}

pub fn gen_scene(r: &mut Rng, n: usize, images: usize, img_len: usize) -> SceneModel {
    let mut m = SceneModel {
        elements: (0..n).map(|i| new_element(r, i)).collect(),
        files: Map::new(),
        app_state: json!({"gridSize": null, "viewBackgroundColor": "#ffffff", "scrollX": 0, "scrollY": 0, "zoom": {"value": 1}}),
        with_files_key: true,
    };
    for _ in 0..images {
        add_image(r, &mut m, img_len);
    }
    m
}

pub fn edit(r: &mut Rng, m: &mut SceneModel) {
    let n = m.elements.len();
    match r.below(10) {
        0 | 1 if n > 0 => {
            let i = r.below(n);
            let o = m.elements[i].as_object_mut().unwrap();
            o.insert("x".into(), json!(r.f()));
            o.insert("version".into(), json!(r.below(1000)));
        }
        2 if n > 0 => {
            let i = r.below(n);
            m.elements[i].as_object_mut().unwrap().insert("strokeColor".into(), json!(format!("#{:06x}", r.below(1 << 24))));
        }
        3 => {
            let el = new_element(r, n);
            let at = if r.chance(70) { n } else { r.below(n + 1) };
            m.elements.insert(at, el);
        }
        4 if n > 0 => {
            let i = r.below(n);
            if r.chance(50) {
                m.elements[i].as_object_mut().unwrap().insert("isDeleted".into(), json!(true));
            } else {
                m.elements.remove(i);
            }
        }
        5 if n > 1 => {
            let (a, b) = (r.below(n), r.below(n));
            m.elements.swap(a, b);
        }
        6 if n > 1 => {
            let a = r.below(n);
            let el = m.elements.remove(a);
            let b = r.below(n);
            m.elements.insert(b, el);
        }
        7 if n > 0 => {
            let i = r.below(n);
            m.elements[i].as_object_mut().unwrap().insert("text".into(), json!(rand_text(r)));
        }
        8 => {
            if r.chance(60) || m.files.is_empty() {
                let len = 50 + r.below(2500);
                add_image(r, m, len);
            } else {
                let k = m.files.keys().nth(r.below(m.files.len())).cloned().unwrap();
                m.files.remove(&k);
                m.elements.retain(|e| e.get("fileId").and_then(Value::as_str) != Some(&k));
            }
        }
        _ => {
            m.app_state.as_object_mut().unwrap().insert("scrollX".into(), json!(r.f()));
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Fmt {
    Compact,
    Pretty,
    Hand,
    /// Hand formatting plus `\/` escapes in strings (payloads then keep their backslashes).
    HandEscaped,
}

pub fn render(m: &SceneModel, fmt: Fmt, r: &mut Rng) -> Vec<u8> {
    let mut root = Map::new();
    root.insert("type".into(), json!("excalidraw"));
    root.insert("version".into(), json!(2));
    root.insert("source".into(), json!("https://excalidraw.com"));
    root.insert("elements".into(), Value::Array(m.elements.clone()));
    root.insert("appState".into(), m.app_state.clone());
    if m.with_files_key {
        root.insert("files".into(), Value::Object(m.files.clone()));
    }
    let v = Value::Object(root);
    match fmt {
        Fmt::Compact => serde_json::to_vec(&v).unwrap(),
        Fmt::Pretty => serde_json::to_vec_pretty(&v).unwrap(),
        Fmt::Hand | Fmt::HandEscaped => {
            let mut out = String::new();
            hand(&v, r, &mut out, matches!(fmt, Fmt::HandEscaped));
            out.into_bytes()
        }
    }
}

fn ws(r: &mut Rng) -> &'static str {
    ["", " ", "\n", "\n  ", "\t", "\r\n    ", "  "][r.below(7)]
}

fn hand_str(s: &str, r: &mut Rng, escape: bool, out: &mut String) {
    let j = serde_json::to_string(s).unwrap();
    if !escape {
        out.push_str(&j);
        return;
    }
    for c in j.chars() {
        if c == '/' && r.chance(50) {
            out.push_str("\\/");
        } else if !c.is_ascii() && r.chance(50) {
            let mut b = [0u16; 2];
            for u in c.encode_utf16(&mut b) {
                out.push_str(&format!("\\u{:04x}", u));
            }
        } else {
            out.push(c);
        }
    }
}

fn hand(v: &Value, r: &mut Rng, out: &mut String, esc: bool) {
    match v {
        Value::Object(m) => {
            out.push('{');
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(ws(r));
                hand_str(k, r, false, out);
                out.push_str(ws(r));
                out.push(':');
                out.push_str(ws(r));
                hand(x, r, out, esc);
            }
            out.push_str(ws(r));
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(ws(r));
                hand(x, r, out, esc);
            }
            out.push_str(ws(r));
            out.push(']');
        }
        Value::String(s) => hand_str(s, r, esc, out),
        other => out.push_str(&other.to_string()),
    }
}

// ----- blob store / memo -----

#[derive(Default)]
pub struct Store {
    /// `<sha>.<ext>` -> bytes (any device's copy)
    pub blobs: RefCell<HashMap<String, Vec<u8>>>,
}
impl Store {
    pub fn own(&self, sha_ext: &str) -> bool {
        self.blobs.borrow().contains_key(sha_ext)
    }
    pub fn absorb(&self, s: &Stripped) {
        for b in &s.new_blobs {
            let name = crate::history::names::BlobName::parse(&b.file).expect("blob file name grammar");
            self.blobs.borrow_mut().insert(name.sha_ext(), b.bytes.clone());
        }
    }
    pub fn read(&self, tok: &str) -> crate::Result<Vec<u8>> {
        self.blobs.borrow().get(tok).cloned().ok_or_else(|| crate::err("VERSION_CORRUPT", "missing blob"))
    }
}

#[derive(Default)]
pub struct MapMemo(pub HashMap<(String, usize, u32), String>);
impl BlobMemo for MapMemo {
    fn lookup(&self, id: &str, len: usize, crc: u32) -> Option<String> {
        self.0.get(&(id.to_string(), len, crc)).cloned()
    }
    fn remember(&mut self, id: &str, len: usize, crc: u32, sha_ext: &str) {
        self.0.insert((id.to_string(), len, crc), sha_ext.to_string());
    }
}

pub fn dev() -> String {
    random_crockford_lower(8)
}
pub fn epoch() -> String {
    epoch_code(2000)
}

#[allow(clippy::too_many_arguments)]
pub fn header(gen: &mut UlidGen, kind: &str, lineage: &str, dev: &str, keyframe: Option<&str>, stripped: &[u8], file: &[u8], s: &Stripped) -> Header {
    Header {
        format: 1,
        kind: kind.into(),
        id: gen.next(1_739_539_200_000),
        lineage: lineage.into(),
        device: dev.into(),
        epoch: epoch(),
        created: 1_739_539_200_000,
        reason: "auto".into(),
        name: None,
        note: None,
        path: "Clients/Acme/flow.excalidraw".into(),
        file_revision: sha_hex(file),
        stripped_hash: sha_hex(stripped),
        file_size: file.len() as u64,
        element_count: s.element_count,
        keyframe: keyframe.map(str::to_string),
        blobs: s.blobs.clone(),
        app: "vaultdraw test".into(),
    }
}
