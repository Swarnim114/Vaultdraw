//! Stripping and inlining images (blob tokens), element slicing, delta encode, reconstruct and
//! the exactness proof (PLAN §2.3, "Codec contract (frozen)").
//!
//! Stripped text = the exact file bytes with each `files[*].dataURL` base64 payload replaced in
//! place by `@vdblob:<sha256>.<ext>` (only when the raw slice has no backslash and decode +
//! re-encode round-trips; otherwise it stays inline).
//!
//! Contract frozen at the H1 skeleton; agent A implements the bodies.

use std::collections::{HashMap, HashSet};

use memchr::{memchr2, memmem};
use sha2::{Digest, Sha256};

use super::names::{is_device, is_epoch, is_sha_ext};
use crate::{err, Result};

pub const BLOB_TOKEN_PREFIX: &str = "@vdblob:";

pub struct BlobOut {
    /// `<sha>-<dev>-<epoch>.<ext>`
    pub file: String,
    pub bytes: Vec<u8>,
}

pub struct Stripped {
    pub text: Vec<u8>,
    /// `<sha>.<ext>` of every stripped payload, in first-seen order, deduplicated.
    pub blobs: Vec<String>,
    /// Payloads whose own current-epoch copy doesn't exist yet (decoded bytes to write).
    pub new_blobs: Vec<BlobOut>,
    pub element_count: u32,
}

/// Remembers `(file id, payload length, crc32 of the payload) → <sha>.<ext>` so unchanged images
/// aren't re-hashed on every version.
pub trait BlobMemo {
    fn lookup(&self, file_id: &str, payload_len: usize, crc: u32) -> Option<String>;
    fn remember(&mut self, file_id: &str, payload_len: usize, crc: u32, sha_ext: &str);
}

/// A memo that remembers nothing (tests, one-off use).
pub struct NoMemo;
impl BlobMemo for NoMemo {
    fn lookup(&self, _: &str, _: usize, _: u32) -> Option<String> { None }
    fn remember(&mut self, _: &str, _: usize, _: u32, _: &str) {}
}

/// Largest text `reconstruct` / `inline` will build (the app's drawing cap is 32 MiB).
pub const MAX_TEXT_BYTES: usize = 64 * 1024 * 1024;

fn corrupt(msg: &str) -> crate::NativeError {
    err("VERSION_CORRUPT", format!("history codec: {msg}"))
}

/// Keyframe rotation rule: a delta whose compressed size is more than 25% of its keyframe's
/// compressed size becomes a new keyframe.
pub fn delta_too_big(delta_compressed: usize, key_compressed: usize) -> bool {
    delta_compressed.saturating_mul(4) > key_compressed
}

// ---------------------------------------------------------------------------------------------
// base64 (standard alphabet, padded; the decoder is canonical-strict so decode + encode always
// reproduces the input exactly)
// ---------------------------------------------------------------------------------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const fn b64_table() -> [u8; 256] {
    let mut t = [0xFFu8; 256];
    let mut i = 0;
    while i < 64 {
        t[B64[i] as usize] = i as u8;
        i += 1;
    }
    t
}
static B64_DEC: [u8; 256] = b64_table();

fn b64_encode_into(out: &mut Vec<u8>, data: &[u8]) {
    out.reserve(data.len().div_ceil(3) * 4);
    let mut chunks = data.chunks_exact(3);
    for c in &mut chunks {
        let n = (c[0] as u32) << 16 | (c[1] as u32) << 8 | c[2] as u32;
        out.extend_from_slice(&[
            B64[(n >> 18) as usize & 63],
            B64[(n >> 12) as usize & 63],
            B64[(n >> 6) as usize & 63],
            B64[n as usize & 63],
        ]);
    }
    match chunks.remainder() {
        [a] => {
            let n = (*a as u32) << 16;
            out.extend_from_slice(&[B64[(n >> 18) as usize & 63], B64[(n >> 12) as usize & 63], b'=', b'=']);
        }
        [a, b] => {
            let n = (*a as u32) << 16 | (*b as u32) << 8;
            out.extend_from_slice(&[
                B64[(n >> 18) as usize & 63],
                B64[(n >> 12) as usize & 63],
                B64[(n >> 6) as usize & 63],
                b'=',
            ]);
        }
        _ => {}
    }
}

/// Strict decode: padded, alphabet only, zero trailing bits. `None` for anything else.
fn b64_decode(s: &[u8]) -> Option<Vec<u8>> {
    if s.is_empty() || s.len() % 4 != 0 {
        return None;
    }
    let pad = s.iter().rev().take(2).take_while(|&&c| c == b'=').count();
    let body = &s[..s.len() - pad];
    let full = (body.len() / 4) * 4;
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    for c in body[..full].chunks_exact(4) {
        let (a, b, cc, d) = (B64_DEC[c[0] as usize], B64_DEC[c[1] as usize], B64_DEC[c[2] as usize], B64_DEC[c[3] as usize]);
        if (a | b | cc | d) & 0x80 != 0 {
            return None;
        }
        let n = (a as u32) << 18 | (b as u32) << 12 | (cc as u32) << 6 | d as u32;
        out.extend_from_slice(&[(n >> 16) as u8, (n >> 8) as u8, n as u8]);
    }
    let rest = &body[full..];
    let v = |c: u8| {
        let x = B64_DEC[c as usize];
        (x & 0x80 == 0).then_some(x as u32)
    };
    match (rest, pad) {
        ([], 0) => {}
        ([a, b], 2) => {
            let n = v(*a)? << 18 | v(*b)? << 12;
            if n & 0xFFFF != 0 {
                return None;
            }
            out.push((n >> 16) as u8);
        }
        ([a, b, c], 1) => {
            let n = v(*a)? << 18 | v(*b)? << 12 | v(*c)? << 6;
            if n & 0xFF != 0 {
                return None;
            }
            out.extend_from_slice(&[(n >> 16) as u8, (n >> 8) as u8]);
        }
        _ => return None,
    }
    Some(out)
}

// ---------------------------------------------------------------------------------------------
// Minimal structural JSON scanner. It never validates; it only finds value boundaries. Exactness
// never depends on it being right: strip only rewrites payloads it verified, and every delta is
// proven by reconstruct + memcmp.
// ---------------------------------------------------------------------------------------------

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while matches!(b.get(i), Some(b' ' | b'\n' | b'\r' | b'\t')) {
        i += 1;
    }
    i
}

/// `b[i]` is the opening quote; returns the index after the closing quote.
fn skip_string(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    loop {
        let k = j + memchr2(b'"', b'\\', b.get(j..)?)?;
        if b[k] == b'"' {
            return Some(k + 1);
        }
        j = k + 2;
    }
}

fn skip_value(b: &[u8], i: usize) -> Option<usize> {
    match *b.get(i)? {
        b'"' => skip_string(b, i),
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut j = i;
            while j < b.len() {
                match b[j] {
                    b'"' => {
                        j = skip_string(b, j)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(j + 1);
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            None
        }
        b',' | b'}' | b']' | b':' => None,
        _ => {
            let mut j = i + 1;
            while j < b.len() && !matches!(b[j], b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t') {
                j += 1;
            }
            Some(j)
        }
    }
}

/// One `"key": value` member: key content range (without quotes) and value range.
struct Member {
    key: (usize, usize),
    val: (usize, usize),
}

/// `*i` is just after `{` (first call) or after the previous member's value.
fn next_member(b: &[u8], i: &mut usize) -> Option<Option<Member>> {
    let mut j = skip_ws(b, *i);
    if b.get(j) == Some(&b',') {
        j = skip_ws(b, j + 1);
    }
    match b.get(j)? {
        b'}' => {
            *i = j + 1;
            return Some(None);
        }
        b'"' => {}
        _ => return None,
    }
    let ke = skip_string(b, j)?;
    let colon = skip_ws(b, ke);
    if b.get(colon) != Some(&b':') {
        return None;
    }
    let vs = skip_ws(b, colon + 1);
    let ve = skip_value(b, vs)?;
    *i = ve;
    Some(Some(Member { key: (j + 1, ke - 1), val: (vs, ve) }))
}

/// Top-level members, calling `f(key, value range)`; `None` if the text isn't a scannable object.
fn for_each_member(b: &[u8], start: usize, mut f: impl FnMut(&[u8], (usize, usize)) -> bool) -> Option<()> {
    let s = skip_ws(b, start);
    if b.get(s) != Some(&b'{') {
        return None;
    }
    let mut i = s + 1;
    while let Some(m) = next_member(b, &mut i)? {
        if !f(&b[m.key.0..m.key.1], m.val) {
            break;
        }
    }
    Some(())
}

fn count_array_items(b: &[u8], (vs, ve): (usize, usize)) -> Option<u32> {
    if b.get(vs) != Some(&b'[') {
        return None;
    }
    let mut n = 0u32;
    let mut i = vs + 1;
    loop {
        let mut j = skip_ws(b, i);
        if b.get(j) == Some(&b']') {
            return (j + 1 == ve).then_some(n);
        }
        if n > 0 {
            if b.get(j) != Some(&b',') {
                return None;
            }
            j = skip_ws(b, j + 1);
        }
        i = skip_value(b, j)?;
        n = n.saturating_add(1);
    }
}

// ---------------------------------------------------------------------------------------------
// strip / inline
// ---------------------------------------------------------------------------------------------

fn ext_for_mime(mime: &[u8]) -> &'static str {
    match mime {
        b"image/png" => "png",
        b"image/jpeg" | b"image/jpg" => "jpg",
        b"image/svg+xml" => "svg",
        b"image/gif" => "gif",
        b"image/webp" => "webp",
        b"image/bmp" => "bmp",
        b"image/avif" => "avif",
        b"image/x-icon" | b"image/vnd.microsoft.icon" => "ico",
        b"image/tiff" => "tiff",
        b"image/apng" => "apng",
        _ => "bin",
    }
}

/// A planned rewrite of `text[start..end]` (an insertion when `start == end`).
struct Edit {
    start: usize,
    end: usize,
    with: Vec<u8>,
}

struct StripCtx<'a> {
    file: &'a [u8],
    memo: &'a mut dyn BlobMemo,
    own_copy_exists: &'a dyn Fn(&str) -> bool,
    dev: &'a str,
    epoch: &'a str,
    edits: Vec<Edit>,
    blobs: Vec<String>,
    new_blobs: Vec<BlobOut>,
    seen: HashSet<String>,
}

impl StripCtx<'_> {
    /// Handles the raw string `file[s..e]` (quotes included) that is a `dataURL` of `file_id`.
    fn data_url(&mut self, file_id: &str, (s, e): (usize, usize)) {
        let Some(content) = self.file.get(s + 1..e.saturating_sub(1)) else { return };
        if memchr::memchr(b'\\', content).is_some() || !content.starts_with(b"data:") {
            return;
        }
        let head = &content[..content.len().min(256)];
        let Some(semi) = memmem::find(head, b";base64,") else { return };
        let ext = ext_for_mime(&content[5..semi]);
        let payload_at = semi + 8;
        let payload = &content[payload_at..];
        if payload.len() < 4 {
            return;
        }
        let crc = crc32fast::hash(payload);
        let memoized = self.memo.lookup(file_id, payload.len(), crc).filter(|t| is_sha_ext(t));
        let (sha_ext, decoded) = match memoized {
            Some(t) if (self.own_copy_exists)(&t) => (t, None),
            Some(t) => match b64_decode(payload) {
                Some(bytes) => (t, Some(bytes)),
                None => return,
            },
            None => {
                let Some(bytes) = b64_decode(payload) else { return };
                let sha_ext = format!("{}.{}", hex::encode(Sha256::digest(&bytes)), ext);
                self.memo.remember(file_id, payload.len(), crc, &sha_ext);
                let decoded = (!(self.own_copy_exists)(&sha_ext)).then_some(bytes);
                (sha_ext, decoded)
            }
        };
        let mut with = Vec::with_capacity(BLOB_TOKEN_PREFIX.len() + sha_ext.len());
        with.extend_from_slice(BLOB_TOKEN_PREFIX.as_bytes());
        with.extend_from_slice(sha_ext.as_bytes());
        self.edits.push(Edit { start: s + 1 + payload_at, end: e - 1, with });
        if self.seen.insert(sha_ext.clone()) {
            if let Some(bytes) = decoded {
                let (sha, ext) = sha_ext.split_once('.').unwrap_or((&sha_ext, "bin"));
                self.new_blobs.push(BlobOut { file: format!("{sha}-{}-{}.{ext}", self.dev, self.epoch), bytes });
            }
            self.blobs.push(sha_ext);
        }
    }

    fn files(&mut self, (vs, ve): (usize, usize)) -> Option<()> {
        let file = self.file;
        if file.get(vs) != Some(&b'{') {
            return None;
        }
        let mut i = vs + 1;
        while let Some(m) = next_member(file, &mut i)? {
            let id = std::str::from_utf8(&file[m.key.0..m.key.1]).unwrap_or("");
            if file.get(m.val.0) != Some(&b'{') {
                continue;
            }
            let mut j = m.val.0 + 1;
            while let Some(f) = next_member(file, &mut j)? {
                if &file[f.key.0..f.key.1] == b"dataURL" && file.get(f.val.0) == Some(&b'"') {
                    self.data_url(id, f.val);
                }
            }
        }
        (i == ve).then_some(())
    }
}

/// `own_copy_exists(sha_ext)` stat-checks this device's current-epoch copy only (B1).
pub fn strip(
    file: &[u8],
    memo: &mut dyn BlobMemo,
    own_copy_exists: &dyn Fn(&str) -> bool,
    dev: &str,
    epoch: &str,
) -> Result<Stripped> {
    if !is_device(dev) || !is_epoch(epoch) {
        return Err(err("INVALID_FILE", "bad device or epoch for blob names"));
    }
    let mut ctx = StripCtx {
        file,
        memo,
        own_copy_exists,
        dev,
        epoch,
        edits: Vec::new(),
        blobs: Vec::new(),
        new_blobs: Vec::new(),
        seen: HashSet::new(),
    };
    let mut elements: Option<u32> = None;
    let mut ok = true;
    let scanned = for_each_member(file, 0, |key, val| {
        match key {
            b"elements" if elements.is_none() => match count_array_items(file, val) {
                Some(n) => elements = Some(n),
                None => ok = false,
            },
            b"files" => ok &= ctx.files(val).is_some(),
            _ => {}
        }
        ok
    });
    let unchanged = |count| Stripped { text: file.to_vec(), blobs: Vec::new(), new_blobs: Vec::new(), element_count: count };
    if scanned.is_none() || !ok {
        return Ok(unchanged(0));
    }
    let element_count = elements.unwrap_or(0);
    // A literal "@vdblob:" in the user's own content gets one extra '@' after the colon, so that
    // `inline` can tell it from a real token (real tokens continue with a hex digit).
    let escapes: Vec<usize> = memmem::find_iter(file, BLOB_TOKEN_PREFIX.as_bytes()).collect();
    if ctx.edits.is_empty() && escapes.is_empty() {
        return Ok(unchanged(element_count));
    }
    let mut edits = std::mem::take(&mut ctx.edits);
    edits.extend(escapes.into_iter().map(|p| {
        let at = p + BLOB_TOKEN_PREFIX.len();
        Edit { start: at, end: at, with: b"@".to_vec() }
    }));
    edits.sort_by_key(|e| (e.start, e.end));
    let mut text = Vec::with_capacity(file.len());
    let mut at = 0usize;
    for e in &edits {
        if e.start < at {
            // Overlap cannot happen (payloads hold no '@'); fall back to the safe, unstripped copy.
            return Ok(unchanged(element_count));
        }
        text.extend_from_slice(&file[at..e.start]);
        text.extend_from_slice(&e.with);
        at = e.end;
    }
    text.extend_from_slice(&file[at..]);
    Ok(Stripped { text, blobs: ctx.blobs, new_blobs: ctx.new_blobs, element_count })
}

/// Parses a token after `@vdblob:`; returns its length (`<sha>.<ext>`), or None when malformed.
fn token_len(rest: &[u8]) -> Option<usize> {
    let ext_run = rest
        .iter()
        .skip(65)
        .take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .count();
    let len = 65 + ext_run;
    let tok = std::str::from_utf8(rest.get(..len)?).ok()?;
    is_sha_ext(tok).then_some(len)
}

/// Replaces every `@vdblob:` token with the base64 of the blob; verifies each blob's sha256.
pub fn inline(stripped: &[u8], read_any_copy: &dyn Fn(&str) -> Result<Vec<u8>>) -> Result<Vec<u8>> {
    let prefix = BLOB_TOKEN_PREFIX.as_bytes();
    let mut out = Vec::with_capacity(stripped.len());
    let mut at = 0usize;
    for p in memmem::find_iter(stripped, prefix) {
        if p < at {
            continue;
        }
        let after = p + prefix.len();
        out.extend_from_slice(&stripped[at..after]);
        let rest = &stripped[after..];
        if rest.first() == Some(&b'@') {
            // escaped literal: drop the extra '@'
            at = after + 1;
            continue;
        }
        let len = token_len(rest).ok_or_else(|| corrupt("malformed blob token"))?;
        out.truncate(out.len() - prefix.len());
        let tok = std::str::from_utf8(&rest[..len]).map_err(|_| corrupt("malformed blob token"))?;
        let bytes = read_any_copy(tok)?;
        if hex::encode(Sha256::digest(&bytes)) != tok[..64] {
            return Err(corrupt("blob content does not match its hash"));
        }
        if out.len().saturating_add(bytes.len().div_ceil(3) * 4) > MAX_TEXT_BYTES {
            return Err(corrupt("inlined text too large"));
        }
        b64_encode_into(&mut out, &bytes);
        at = after + len;
    }
    out.extend_from_slice(&stripped[at..]);
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// delta
// ---------------------------------------------------------------------------------------------

/// A scene cut into: prefix, elements (id, raw object), the gaps between them, suffix.
struct Scene<'a> {
    prefix: &'a [u8],
    suffix: &'a [u8],
    elems: Vec<(&'a [u8], &'a [u8])>,
    gaps: Vec<&'a [u8]>,
}

/// Id (raw bytes inside the quotes) of the element object `b[..]` that must span all of `b`.
fn element_id(b: &[u8], start: usize) -> Option<(&[u8], usize)> {
    if b.get(start) != Some(&b'{') {
        return None;
    }
    let mut i = start + 1;
    let mut id = None;
    while let Some(m) = next_member(b, &mut i)? {
        if id.is_none() && &b[m.key.0..m.key.1] == b"id" && b[m.val.0] == b'"' {
            id = Some(&b[m.val.0 + 1..m.val.1 - 1]);
        }
    }
    Some((id?, i))
}

fn parse_scene(b: &[u8]) -> Option<Scene<'_>> {
    let mut range = None;
    let mut dup = false;
    for_each_member(b, 0, |key, val| {
        if key == b"elements" {
            dup |= range.is_some();
            range = Some(val);
        }
        true
    })?;
    let (vs, _) = range.filter(|_| !dup)?;
    if b.get(vs) != Some(&b'[') {
        return None;
    }
    let mut elems = Vec::new();
    let mut gaps = Vec::new();
    let mut prev_end: Option<usize> = None;
    let mut first_start = None;
    let mut i = vs + 1;
    loop {
        let mut j = skip_ws(b, i);
        if b.get(j) == Some(&b']') {
            break;
        }
        if let Some(pe) = prev_end {
            if b.get(j) != Some(&b',') {
                return None;
            }
            j = skip_ws(b, j + 1);
            gaps.push(&b[pe..j]);
        } else {
            first_start = Some(j);
        }
        let (id, end) = element_id(b, j)?;
        elems.push((id, &b[j..end]));
        prev_end = Some(end);
        i = end;
    }
    let (prefix, suffix) = match (first_start, prev_end) {
        (Some(fs), Some(le)) => (&b[..fs], &b[le..]),
        _ => (&b[..vs + 1], &b[vs + 1..]),
    };
    Some(Scene { prefix, suffix, elems, gaps })
}

fn id_map<'a>(elems: &[(&'a [u8], &'a [u8])]) -> Option<HashMap<&'a [u8], usize>> {
    let mut m = HashMap::with_capacity(elems.len());
    for (i, (id, _)) in elems.iter().enumerate() {
        if m.insert(*id, i).is_some() {
            return None;
        }
    }
    Some(m)
}

const DELTA_MAGIC: &[u8; 4] = b"VDD1";
const FLAG_PREFIX_SAME: u8 = 1;
const FLAG_SUFFIX_SAME: u8 = 2;
const FLAG_ORDER: u8 = 4;

fn put_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push(v as u8 | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn put_bytes(out: &mut Vec<u8>, b: &[u8]) {
    put_varint(out, b.len() as u64);
    out.extend_from_slice(b);
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn byte(&mut self) -> Result<u8> {
        let b = *self.buf.get(self.pos).ok_or_else(|| corrupt("delta truncated"))?;
        self.pos += 1;
        Ok(b)
    }
    fn varint(&mut self) -> Result<u64> {
        let mut v = 0u64;
        for shift in (0..64).step_by(7) {
            let b = self.byte()?;
            v |= ((b & 0x7F) as u64) << shift;
            if b & 0x80 == 0 {
                return Ok(v);
            }
        }
        Err(corrupt("delta varint too long"))
    }
    fn bytes(&mut self) -> Result<&'a [u8]> {
        let len = usize::try_from(self.varint()?).map_err(|_| corrupt("delta length"))?;
        let end = self.pos.checked_add(len).filter(|&e| e <= self.buf.len()).ok_or_else(|| corrupt("delta truncated"))?;
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Ok(s)
    }
}

fn encode_with(k: &Scene, new: &[u8]) -> Option<Vec<u8>> {
    let n = parse_scene(new)?;
    let kmap = id_map(&k.elems)?;
    let nmap = id_map(&n.elems)?;
    let mut changed: Vec<&[u8]> = Vec::new();
    for (id, raw) in &n.elems {
        match kmap.get(id) {
            Some(&ki) if k.elems[ki].1 == *raw => {}
            _ => changed.push(raw),
        }
    }
    let removed: Vec<&[u8]> = k.elems.iter().map(|e| e.0).filter(|id| !nmap.contains_key(id)).collect();
    // Default merged order: surviving key elements, then new ids in new order.
    let mut surv = vec![usize::MAX; k.elems.len()];
    let mut next = 0usize;
    for (ki, (id, _)) in k.elems.iter().enumerate() {
        if nmap.contains_key(id) {
            surv[ki] = next;
            next += 1;
        }
    }
    let mut order = Vec::with_capacity(n.elems.len());
    for (id, _) in &n.elems {
        match kmap.get(id) {
            Some(&ki) => order.push(surv[ki]),
            None => {
                order.push(next);
                next += 1;
            }
        }
    }
    let reordered = order.iter().enumerate().any(|(i, &o)| i != o);

    let mut flags = 0u8;
    if n.prefix == k.prefix {
        flags |= FLAG_PREFIX_SAME;
    }
    if n.suffix == k.suffix {
        flags |= FLAG_SUFFIX_SAME;
    }
    if reordered {
        flags |= FLAG_ORDER;
    }
    let mut out = Vec::with_capacity(64 + changed.iter().map(|c| c.len() + 4).sum::<usize>());
    out.extend_from_slice(DELTA_MAGIC);
    out.push(flags);
    if flags & FLAG_PREFIX_SAME == 0 {
        put_bytes(&mut out, n.prefix);
    }
    if flags & FLAG_SUFFIX_SAME == 0 {
        put_bytes(&mut out, n.suffix);
    }
    let sep = n.gaps.first().copied().unwrap_or(b"");
    put_bytes(&mut out, sep);
    let exceptions: Vec<(usize, &[u8])> = n.gaps.iter().copied().enumerate().filter(|(_, g)| *g != sep).collect();
    put_varint(&mut out, exceptions.len() as u64);
    for (i, g) in exceptions {
        put_varint(&mut out, i as u64);
        put_bytes(&mut out, g);
    }
    put_varint(&mut out, changed.len() as u64);
    for c in changed {
        put_bytes(&mut out, c);
    }
    put_varint(&mut out, removed.len() as u64);
    for id in removed {
        put_bytes(&mut out, id);
    }
    if reordered {
        put_varint(&mut out, order.len() as u64);
        for o in order {
            put_varint(&mut out, o as u64);
        }
    }
    Some(out)
}

fn apply(k: &Scene, body: &[u8]) -> Result<Vec<u8>> {
    let mut r = Reader { buf: body, pos: 0 };
    if body.get(..4) != Some(DELTA_MAGIC) {
        return Err(corrupt("bad delta magic"));
    }
    r.pos = 4;
    let flags = r.byte()?;
    let prefix = if flags & FLAG_PREFIX_SAME != 0 { k.prefix } else { r.bytes()? };
    let suffix = if flags & FLAG_SUFFIX_SAME != 0 { k.suffix } else { r.bytes()? };
    let sep = r.bytes()?;
    let mut exceptions: HashMap<usize, &[u8]> = HashMap::new();
    for _ in 0..r.varint()? {
        let i = usize::try_from(r.varint()?).map_err(|_| corrupt("delta gap index"))?;
        exceptions.insert(i, r.bytes()?);
    }
    let kmap = id_map(&k.elems).ok_or_else(|| corrupt("keyframe has duplicate ids"))?;
    let mut replaced: Vec<Option<&[u8]>> = vec![None; k.elems.len()];
    let mut added: Vec<&[u8]> = Vec::new();
    let mut added_ids: HashSet<&[u8]> = HashSet::new();
    for _ in 0..r.varint()? {
        let raw = r.bytes()?;
        let (id, end) = element_id(raw, 0).ok_or_else(|| corrupt("bad changed element"))?;
        if end != raw.len() {
            return Err(corrupt("bad changed element"));
        }
        match kmap.get(id) {
            Some(&ki) => {
                if replaced[ki].replace(raw).is_some() {
                    return Err(corrupt("duplicate changed element"));
                }
            }
            None => {
                if !added_ids.insert(id) {
                    return Err(corrupt("duplicate added element"));
                }
                added.push(raw);
            }
        }
    }
    let mut removed = vec![false; k.elems.len()];
    for _ in 0..r.varint()? {
        let ki = *kmap.get(r.bytes()?).ok_or_else(|| corrupt("removed id not in keyframe"))?;
        removed[ki] = true;
    }
    let mut merged: Vec<&[u8]> = Vec::with_capacity(k.elems.len() + added.len());
    for (ki, (_, raw)) in k.elems.iter().enumerate() {
        if !removed[ki] {
            merged.push(replaced[ki].unwrap_or(raw));
        }
    }
    merged.extend(added);
    let elems: Vec<&[u8]> = if flags & FLAG_ORDER != 0 {
        let n = usize::try_from(r.varint()?).map_err(|_| corrupt("delta order"))?;
        if n != merged.len() {
            return Err(corrupt("delta order length"));
        }
        let mut used = vec![false; n];
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            let o = usize::try_from(r.varint()?).map_err(|_| corrupt("delta order"))?;
            match used.get_mut(o) {
                Some(u) if !*u => *u = true,
                _ => return Err(corrupt("delta order is not a permutation")),
            }
            v.push(merged[o]);
        }
        v
    } else {
        merged
    };
    if r.pos != body.len() {
        return Err(corrupt("trailing bytes in delta"));
    }
    let gaps = elems.len().saturating_sub(1);
    if exceptions.keys().any(|&i| i >= gaps) {
        return Err(corrupt("delta gap index out of range"));
    }
    let exc_len: usize = exceptions.values().map(|g| g.len()).sum();
    let total = prefix
        .len()
        .saturating_add(suffix.len())
        .saturating_add(elems.iter().map(|e| e.len()).sum::<usize>())
        .saturating_add(sep.len().saturating_mul(gaps))
        .saturating_add(exc_len);
    if total > MAX_TEXT_BYTES {
        return Err(corrupt("reconstructed text too large"));
    }
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(prefix);
    for (i, e) in elems.iter().enumerate() {
        if i > 0 {
            out.extend_from_slice(exceptions.get(&(i - 1)).copied().unwrap_or(sep));
        }
        out.extend_from_slice(e);
    }
    out.extend_from_slice(suffix);
    Ok(out)
}

/// A delta from `key` (stripped keyframe text) to `new` (stripped text), or `None` when the scene
/// can't be sliced (then the caller writes a keyframe). The caller still runs the exactness proof.
pub fn encode_delta(key: &[u8], new: &[u8]) -> Option<Vec<u8>> {
    encode_with(&parse_scene(key)?, new)
}
/// Rebuilds the stripped text from a keyframe and an optional delta body.
pub fn reconstruct(key: &[u8], delta: Option<&[u8]>) -> Result<Vec<u8>> {
    match delta {
        None => Ok(key.to_vec()),
        Some(body) => apply(&parse_scene(key).ok_or_else(|| corrupt("keyframe not sliceable"))?, body),
    }
}
/// Encodes a delta and proves `reconstruct(key, delta) == new` byte for byte; `None` = write a keyframe.
pub fn proven_delta(key: &[u8], new: &[u8]) -> Option<Vec<u8>> {
    let k = parse_scene(key)?;
    let body = encode_with(&k, new)?;
    (apply(&k, &body).ok()? == new).then_some(body)
}
