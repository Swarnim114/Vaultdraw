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
    pub fn code(self) -> char {
        match self {
            Reason::Auto => 'a',
            Reason::Leave => 'l',
            Reason::Checkpoint => 'c',
            Reason::BeforeOutside => 'o',
            Reason::BeforeRestore => 'r',
            Reason::BeforeClear => 'x',
            Reason::First => 'f',
            Reason::Recovered => 'v',
            Reason::DiscardedEdits => 'e',
            Reason::Moved => 'm',
            Reason::Unknown(c) => c,
        }
    }
    pub fn from_code(c: char) -> Reason {
        match c {
            'a' => Reason::Auto,
            'l' => Reason::Leave,
            'c' => Reason::Checkpoint,
            'o' => Reason::BeforeOutside,
            'r' => Reason::BeforeRestore,
            'x' => Reason::BeforeClear,
            'f' => Reason::First,
            'v' => Reason::Recovered,
            'e' => Reason::DiscardedEdits,
            'm' => Reason::Moved,
            other => Reason::Unknown(other),
        }
    }
    /// Header / IPC word: "auto", "leave", "checkpoint", "before-outside-change", "before-restore",
    /// "before-clear", "first", "recovered", "discarded-edits", "moved", "unknown".
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Auto => "auto",
            Reason::Leave => "leave",
            Reason::Checkpoint => "checkpoint",
            Reason::BeforeOutside => "before-outside-change",
            Reason::BeforeRestore => "before-restore",
            Reason::BeforeClear => "before-clear",
            Reason::First => "first",
            Reason::Recovered => "recovered",
            Reason::DiscardedEdits => "discarded-edits",
            Reason::Moved => "moved",
            Reason::Unknown(_) => "unknown",
        }
    }
    pub fn from_str(s: &str) -> Reason {
        match s {
            "auto" => Reason::Auto,
            "leave" => Reason::Leave,
            "checkpoint" => Reason::Checkpoint,
            "before-outside-change" => Reason::BeforeOutside,
            "before-restore" => Reason::BeforeRestore,
            "before-clear" => Reason::BeforeClear,
            "first" => Reason::First,
            "recovered" => Reason::Recovered,
            "discarded-edits" => Reason::DiscardedEdits,
            "moved" => Reason::Moved,
            _ => Reason::Unknown('?'),
        }
    }
    /// Full fsync + directory fsync (c/r/o/f/e, and path records) instead of a barrier fsync (a/l/v/x).
    pub fn needs_full_sync(self) -> bool {
        matches!(
            self,
            Reason::Checkpoint
                | Reason::BeforeRestore
                | Reason::BeforeOutside
                | Reason::First
                | Reason::DiscardedEdits
                | Reason::Moved
        )
    }
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

const ULID_LEN: usize = 26;
const DEV_LEN: usize = 8;
const EPOCH_LEN: usize = 4;
const SHA_LEN: usize = 64;

fn is_reason_letter(b: u8) -> bool {
    b.is_ascii_lowercase()
}

impl VersionName {
    pub fn parse(file_name: &str) -> Option<VersionName> {
        let stem = file_name.strip_suffix(".vdh")?;
        let b = stem.as_bytes();
        // ULID '-' dev '.' kind
        let kind_at = ULID_LEN + 1 + DEV_LEN + 1;
        if b.len() < kind_at + 2 || b[ULID_LEN] != b'-' || b[kind_at - 1] != b'.' {
            return None;
        }
        let id = stem.get(..ULID_LEN)?;
        let dev = stem.get(ULID_LEN + 1..ULID_LEN + 1 + DEV_LEN)?;
        if !is_ulid(id) || !is_device(dev) {
            return None;
        }
        let kind = &b[kind_at..];
        let kind = match kind {
            b"pm" => NameKind::Path,
            [b'k', r] if is_reason_letter(*r) => NameKind::Keyframe(Reason::from_code(*r as char)),
            [b'd', r, key @ ..] if is_reason_letter(*r) && key.len() == ULID_LEN => {
                let key = std::str::from_utf8(key).ok()?;
                if !is_ulid(key) {
                    return None;
                }
                NameKind::Delta(Reason::from_code(*r as char), key.to_string())
            }
            _ => return None,
        };
        Some(VersionName { id: id.to_string(), dev: dev.to_string(), kind })
    }
    pub fn format(&self) -> String {
        let kind = match &self.kind {
            NameKind::Keyframe(r) => format!("k{}", r.code()),
            NameKind::Delta(r, key) => format!("d{}{}", r.code(), key),
            NameKind::Path => "pm".to_string(),
        };
        format!("{}-{}.{}.vdh", self.id, self.dev, kind)
    }
    pub fn reason(&self) -> Reason {
        match &self.kind {
            NameKind::Keyframe(r) | NameKind::Delta(r, _) => *r,
            NameKind::Path => Reason::Moved,
        }
    }
    pub fn is_keyframe(&self) -> bool {
        matches!(self.kind, NameKind::Keyframe(_))
    }
    /// Milliseconds encoded in the ULID.
    pub fn time_ms(&self) -> u64 {
        ulid_time_ms(&self.id).unwrap_or(0)
    }
}

/// `blobs/<h2>/<sha256>-<dev>-<epoch>.<ext>`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlobName {
    pub sha: String,
    pub dev: String,
    pub epoch: String,
    pub ext: String,
}

fn is_ext(s: &str) -> bool {
    (1..=8).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn is_lower_hex(s: &str) -> bool {
    s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

impl BlobName {
    pub fn parse(file_name: &str) -> Option<BlobName> {
        let b = file_name.as_bytes();
        let dev_at = SHA_LEN + 1;
        let ep_at = dev_at + DEV_LEN + 1;
        let ext_at = ep_at + EPOCH_LEN + 1;
        if b.len() <= ext_at || b[SHA_LEN] != b'-' || b[ep_at - 1] != b'-' || b[ext_at - 1] != b'.' {
            return None;
        }
        let sha = file_name.get(..SHA_LEN)?;
        let dev = file_name.get(dev_at..dev_at + DEV_LEN)?;
        let epoch = file_name.get(ep_at..ep_at + EPOCH_LEN)?;
        let ext = file_name.get(ext_at..)?;
        if !(sha.len() == SHA_LEN && is_lower_hex(sha) && is_device(dev) && is_epoch(epoch) && is_ext(ext)) {
            return None;
        }
        Some(BlobName { sha: sha.into(), dev: dev.into(), epoch: epoch.into(), ext: ext.into() })
    }
    pub fn format(&self) -> String {
        format!("{}-{}-{}.{}", self.sha, self.dev, self.epoch, self.ext)
    }
    /// `<sha>.<ext>`, the token form any device's copy can serve.
    pub fn sha_ext(&self) -> String {
        format!("{}.{}", self.sha, self.ext)
    }
    /// First two hex chars of the sha (the shard folder).
    pub fn shard(&self) -> &str {
        self.sha.get(..2).unwrap_or("")
    }
}

/// `<sha256 hex 64>.<ext 1..8 [a-z0-9]>` (the part after `@vdblob:`).
pub fn is_sha_ext(s: &str) -> bool {
    match s.get(..SHA_LEN) {
        Some(sha) => is_lower_hex(sha) && s.as_bytes().get(SHA_LEN) == Some(&b'.') && s.get(SHA_LEN + 1..).is_some_and(is_ext),
        None => false,
    }
}

fn crockford_upper(c: u8) -> Option<u8> {
    // value of an upper-case Crockford char, None for I L O U and everything else
    CROCKFORD.iter().position(|&x| x == c).map(|p| p as u8)
}

fn is_crockford_lower(c: u8) -> bool {
    !c.is_ascii_uppercase() && crockford_upper(c.to_ascii_uppercase()).is_some()
}

/// 26 Crockford upper-case chars.
pub fn is_ulid(s: &str) -> bool {
    s.len() == ULID_LEN && s.bytes().all(|c| crockford_upper(c).is_some())
}
/// 8 Crockford lower-case chars.
pub fn is_device(s: &str) -> bool {
    s.len() == DEV_LEN && s.bytes().all(is_crockford_lower)
}
/// 4 Crockford lower-case chars.
pub fn is_epoch(s: &str) -> bool {
    s.len() == EPOCH_LEN && s.bytes().all(is_crockford_lower)
}
pub fn ulid_time_ms(id: &str) -> Option<u64> {
    if !is_ulid(id) {
        return None;
    }
    let b = id.as_bytes();
    // first char carries 3 bits only (48-bit time in 10 chars)
    if crockford_upper(b[0])? > 7 {
        return None;
    }
    let mut v: u64 = 0;
    for &c in &b[..10] {
        v = (v << 5) | crockford_upper(c)? as u64;
    }
    Some(v)
}

extern "C" {
    fn getentropy(buf: *mut core::ffi::c_void, len: usize) -> i32;
}
#[cfg(target_os = "macos")]
extern "C" {
    fn gethostuuid(id: *mut u8, wait: *const [i64; 2]) -> i32;
}

/// Fills `buf` from the OS CSPRNG. Falls back to a clock/address mix only if the syscall fails
/// (never expected on macOS), so ids stay unique enough rather than panicking.
fn fill_random(buf: &mut [u8]) {
    // SAFETY: buf is a valid writable slice of at most 256 bytes per call.
    let ok = buf.chunks_mut(256).all(|c| unsafe { getentropy(c.as_mut_ptr().cast(), c.len()) } == 0);
    if !ok {
        let mut x = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
            ^ (buf.as_ptr() as u64);
        for b in buf.iter_mut() {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            *b = x as u8;
        }
    }
}

/// Monotonic ULID generator: ids use `max(now, last_issued + 1)` ms, so a clock step back can't
/// reorder versions. `last_issued` is persisted in `<state>/history/ulid-last` (best effort).
pub struct UlidGen {
    last_ms: u64,
    persist: Option<std::path::PathBuf>,
}

const MAX_ULID_MS: u64 = (1 << 48) - 1;

impl UlidGen {
    /// Loads `ulid-last` from `state_history_dir` when given (missing/corrupt = 0).
    pub fn load(state_history_dir: Option<&Path>) -> UlidGen {
        let persist = state_history_dir.map(|d| d.join("ulid-last"));
        let last_ms = persist
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|&v| v <= MAX_ULID_MS)
            .unwrap_or(0);
        UlidGen { last_ms, persist }
    }
    /// A new id; 80 random bits from `getentropy` (extern "C").
    pub fn next(&mut self, now_ms: u64) -> String {
        let ms = now_ms.max(self.last_ms.saturating_add(1)).min(MAX_ULID_MS);
        self.last_ms = ms;
        self.save();
        let mut rnd = [0u8; 10];
        fill_random(&mut rnd);
        encode_ulid(ms, &rnd)
    }
    fn save(&self) {
        let Some(path) = &self.persist else { return };
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, self.last_ms.to_string()).is_ok() && std::fs::rename(&tmp, path).is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
    }
}

fn encode_ulid(ms: u64, rnd: &[u8; 10]) -> String {
    let mut v: u128 = (ms as u128) << 80;
    let mut r: u128 = 0;
    for &b in rnd {
        r = (r << 8) | b as u128;
    }
    v |= r;
    let mut out = [0u8; ULID_LEN];
    for (i, o) in out.iter_mut().enumerate() {
        let shift = 5 * (ULID_LEN - 1 - i) as u32;
        *o = CROCKFORD[((v >> shift) & 31) as usize];
    }
    // ASCII by construction.
    String::from_utf8_lossy(&out).into_owned()
}

fn host_uuid() -> String {
    #[cfg(target_os = "macos")]
    {
        let mut id = [0u8; 16];
        let wait: [i64; 2] = [1, 0];
        // SAFETY: id is 16 writable bytes (uuid_t); wait is a valid timespec.
        if unsafe { gethostuuid(id.as_mut_ptr(), &wait) } == 0 {
            return hex::encode(id);
        }
    }
    String::new()
}

/// Device id stored in `<state>/history/device` with the host UUID (`gethostuuid`); a mismatch
/// (cloned Mac / restored backup) makes a new id.
pub fn load_or_create_device(state_history_dir: &Path) -> std::io::Result<String> {
    let path = state_history_dir.join("device");
    let uuid = host_uuid();
    if let Ok(text) = std::fs::read_to_string(&path) {
        let mut parts = text.split_whitespace();
        if let Some(dev) = parts.next() {
            if is_device(dev) && parts.next().unwrap_or("") == uuid {
                return Ok(dev.to_string());
            }
        }
    }
    std::fs::create_dir_all(state_history_dir)?;
    let dev = random_crockford_lower(DEV_LEN);
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, format!("{dev} {uuid}\n"))?;
    std::fs::rename(&tmp, &path)?;
    Ok(dev)
}

const DAYS_1970_TO_2020: u64 = 18262;
const MS_PER_DAY: u64 = 86_400_000;

/// Days since 2020-01-01 (UTC) for `ms`.
pub fn day_number(ms: u64) -> u32 {
    (ms / MS_PER_DAY).saturating_sub(DAYS_1970_TO_2020) as u32
}
/// 4 lower-case Crockford chars for a day number.
pub fn epoch_code(day: u32) -> String {
    let mut out = [0u8; EPOCH_LEN];
    for (i, o) in out.iter_mut().enumerate() {
        let shift = 5 * (EPOCH_LEN - 1 - i) as u32;
        *o = CROCKFORD[((day >> shift) & 31) as usize].to_ascii_lowercase();
    }
    String::from_utf8_lossy(&out).into_owned()
}
/// Random lower-case Crockford chars (device ids, tests).
pub fn random_crockford_lower(len: usize) -> String {
    let mut buf = vec![0u8; len];
    fill_random(&mut buf);
    buf.iter().map(|b| CROCKFORD[(b & 31) as usize].to_ascii_lowercase() as char).collect()
}
