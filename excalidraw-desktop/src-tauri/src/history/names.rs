//! ULIDs, device ids, blob epochs, file-name grammar, reason codes and the strict validators
//! every name read from disk, IPC or a header goes through (PLAN §2.3 "Validation", M13).
//! No regex crate: the grammar is checked by hand.
//!
//! Contract frozen at the H1 skeleton; agent A implements the bodies (additions allowed,
//! signature changes need the feature lead).

use std::path::Path;

/// Crockford base32 alphabet (upper case; device ids and epochs use the lower-case form).
pub const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Why a version was made. One code letter in the file name, a word in the header.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Reason {
    Auto,          // a
    Leave,         // l
    Checkpoint,    // c
    BeforeOutside, // o
    BeforeRestore, // r
    BeforeClear,   // x
    First,         // f
    Recovered,     // v
    DiscardedEdits, // e
    Moved,         // m (path records only)
    /// A code this app doesn't know: shown as "Version", never deleted.
    Unknown(char),
}

impl Reason {
    pub fn code(self) -> char { unimplemented!() }
    pub fn from_code(c: char) -> Reason { unimplemented!() }
    /// Header / IPC word: "auto", "leave", "checkpoint", "before-outside-change", "before-restore",
    /// "before-clear", "first", "recovered", "discarded-edits", "moved", "unknown".
    pub fn as_str(self) -> &'static str { unimplemented!() }
    pub fn from_str(s: &str) -> Reason { unimplemented!() }
    /// Full fsync + directory fsync (c/r/o/f/e) instead of a barrier fsync (a/l/v/x).
    pub fn needs_full_sync(self) -> bool { unimplemented!() }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NameKind {
    /// `k<r>`
    Keyframe(Reason),
    /// `d<r><key-id>`
    Delta(Reason, String),
    /// `pm`
    Path,
}

/// `<id>-<dev>.<kind>.vdh`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VersionName {
    pub id: String,
    pub dev: String,
    pub kind: NameKind,
}

impl VersionName {
    pub fn parse(file_name: &str) -> Option<VersionName> { unimplemented!() }
    pub fn format(&self) -> String { unimplemented!() }
    pub fn reason(&self) -> Reason { unimplemented!() }
    pub fn is_keyframe(&self) -> bool { unimplemented!() }
    /// Milliseconds encoded in the ULID.
    pub fn time_ms(&self) -> u64 { unimplemented!() }
}

/// `blobs/<h2>/<sha256>-<dev>-<epoch>.<ext>`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlobName {
    pub sha: String,
    pub dev: String,
    pub epoch: String,
    pub ext: String,
}

impl BlobName {
    pub fn parse(file_name: &str) -> Option<BlobName> { unimplemented!() }
    pub fn format(&self) -> String { unimplemented!() }
    /// `<sha>.<ext>`, the token form any device's copy can serve.
    pub fn sha_ext(&self) -> String { unimplemented!() }
    /// First two hex chars of the sha (the shard folder).
    pub fn shard(&self) -> &str { unimplemented!() }
}

/// `<sha256 hex 64>.<ext 1..8 [a-z0-9]>` (the part after `@vdblob:`).
pub fn is_sha_ext(s: &str) -> bool { unimplemented!() }
/// 26 Crockford upper-case chars.
pub fn is_ulid(s: &str) -> bool { unimplemented!() }
/// 8 Crockford lower-case chars.
pub fn is_device(s: &str) -> bool { unimplemented!() }
/// 4 Crockford lower-case chars.
pub fn is_epoch(s: &str) -> bool { unimplemented!() }
pub fn ulid_time_ms(id: &str) -> Option<u64> { unimplemented!() }

/// Monotonic ULID generator: ids use `max(now, last_issued + 1)` ms, so a clock step back can't
/// reorder versions. `last_issued` is persisted in `<state>/history/ulid-last` (best effort).
pub struct UlidGen {
    last_ms: u64,
    persist: Option<std::path::PathBuf>,
}

impl UlidGen {
    /// Loads `ulid-last` from `state_history_dir` when given (missing/corrupt = 0).
    pub fn load(state_history_dir: Option<&Path>) -> UlidGen { unimplemented!() }
    /// A new id; 80 random bits from `getentropy` (extern "C").
    pub fn next(&mut self, now_ms: u64) -> String { unimplemented!() }
}

/// Device id stored in `<state>/history/device` with the host UUID (`gethostuuid`); a mismatch
/// (cloned Mac / restored backup) makes a new id.
pub fn load_or_create_device(state_history_dir: &Path) -> std::io::Result<String> { unimplemented!() }
/// Days since 2020-01-01 (UTC) for `ms`.
pub fn day_number(ms: u64) -> u32 { unimplemented!() }
/// 4 lower-case Crockford chars for a day number.
pub fn epoch_code(day: u32) -> String { unimplemented!() }
/// Random lower-case Crockford chars (device ids, tests).
pub fn random_crockford_lower(len: usize) -> String { unimplemented!() }
