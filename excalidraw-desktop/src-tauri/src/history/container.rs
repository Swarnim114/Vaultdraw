//! `.vdh` container (PLAN §2.3): `VDH`, major (1 byte), header frame length (u32 LE), header zstd
//! frame (JSON, checksum on), body zstd frame (checksum on). Bounded decode (header ≤ 64 KiB,
//! body ≤ cap) — synced history is untrusted input (M13).
//!
//! Contract frozen at the H1 skeleton; agent A implements the bodies.

use crate::Result;
use serde::{Deserialize, Serialize};

pub const MAGIC: &[u8; 3] = b"VDH";
pub const MAJOR: u8 = 1;
pub const PREFIX_LEN: usize = 8;
pub const MAX_HEADER_BYTES: usize = 64 * 1024;
pub const MAX_NAME_CHARS: usize = 120;
pub const MAX_NOTE_CHARS: usize = 2000;
pub const ZSTD_LEVEL: i32 = 3;

/// Header JSON v1. Unknown fields are ignored; new optional fields are a minor change.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub format: u32,
    /// "keyframe" | "delta" | "path"
    pub kind: String,
    pub id: String,
    pub lineage: String,
    pub device: String,
    pub epoch: String,
    pub created: u64,
    /// `Reason::as_str`
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Vault-relative drawing path at write time (validated with `validate_relative` on read).
    pub path: String,
    /// sha256 hex of the exact file bytes (the save path's revision).
    #[serde(default)]
    pub file_revision: String,
    /// sha256 hex of the stripped text.
    #[serde(default)]
    pub stripped_hash: String,
    #[serde(default)]
    pub file_size: u64,
    #[serde(default)]
    pub element_count: u32,
    /// Delta only: the keyframe id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyframe: Option<String>,
    /// `<sha>.<ext>` tokens referenced by this version.
    #[serde(default)]
    pub blobs: Vec<String>,
    #[serde(default)]
    pub app: String,
}

impl Header {
    /// Checks every field against the M13 rules (ids, device, epoch, blobs, name/note length,
    /// hashes are 64 hex, path via `validate_relative`). Called by `read_header`.
    pub fn validate(&self) -> Result<()> { unimplemented!() }
}

pub fn write_container(header: &Header, body: &[u8], level: i32) -> Vec<u8> { unimplemented!() }
/// Parses and validates the header from a prefix of the file (one 4 KiB pread usually suffices;
/// returns `VERSION_CORRUPT` if the prefix is too short for the declared header length).
pub fn read_header(prefix: &[u8]) -> Result<Header> { unimplemented!() }
/// Header frame length declared in the prefix (so callers know how much to read).
pub fn header_len(prefix: &[u8]) -> Result<usize> { unimplemented!() }
/// Decodes the body frame, refusing more than `cap` bytes (declared content size checked first).
pub fn read_body(file: &[u8], cap: usize) -> Result<Vec<u8>> { unimplemented!() }
