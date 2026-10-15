//! Stripping and inlining images (blob tokens), element slicing, delta encode, reconstruct and
//! the exactness proof (PLAN §2.3, "Codec contract (frozen)").
//!
//! Stripped text = the exact file bytes with each `files[*].dataURL` base64 payload replaced in
//! place by `@vdblob:<sha256>.<ext>` (only when the raw slice has no backslash and decode +
//! re-encode round-trips; otherwise it stays inline).
//!
//! Contract frozen at the H1 skeleton; agent A implements the bodies.

use crate::Result;

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

/// `own_copy_exists(sha_ext)` stat-checks this device's current-epoch copy only (B1).
pub fn strip(file: &[u8], memo: &mut dyn BlobMemo, own_copy_exists: &dyn Fn(&str) -> bool, dev: &str, epoch: &str) -> Result<Stripped> { unimplemented!() }
/// A delta from `key` (stripped keyframe text) to `new` (stripped text), or `None` when the scene
/// can't be sliced (then the caller writes a keyframe). The caller still runs the exactness proof.
pub fn encode_delta(key: &[u8], new: &[u8]) -> Option<Vec<u8>> { unimplemented!() }
/// Rebuilds the stripped text from a keyframe and an optional delta body.
pub fn reconstruct(key: &[u8], delta: Option<&[u8]>) -> Result<Vec<u8>> { unimplemented!() }
/// Replaces every `@vdblob:` token with the base64 of the blob; verifies each blob's sha256.
pub fn inline(stripped: &[u8], read_any_copy: &dyn Fn(&str) -> Result<Vec<u8>>) -> Result<Vec<u8>> { unimplemented!() }
/// Encodes a delta and proves `reconstruct(key, delta) == new` byte for byte; `None` = write a keyframe.
pub fn proven_delta(key: &[u8], new: &[u8]) -> Option<Vec<u8>> { unimplemented!() }
