//! Outside changes: watcher paths against the staged identity ("Before outside change"),
//! `history_snapshot_bytes` (M15, Minor 14) and the pre-rewrite state of link updates (D-R2).
//!
//! Contract frozen at the H3 skeleton (PLAN-H3.md §3); agent I implements the bodies.
use super::{SnapshotOutcome, VaultHistory};
use crate::{err, Result};

/// Watcher batch of vault paths (runs on the watcher thread: must only queue work, ≤ 20 µs/path).
pub(super) fn watched(_vh: &VaultHistory, _entries: &[String]) {}

/// Raw scene bytes from the frontend (staging off, or a conflict reload discarding edits).
pub(super) fn snapshot_bytes(_vh: &VaultHistory, _path: &str, _reason: &str, _revision: &str, _body: &[u8]) -> Result<SnapshotOutcome> {
    Err(err("HISTORY_OFF", "Snapshots of unsaved bytes are not available yet"))
}

/// Links are about to rewrite `path` (closed drawing): keep its current state if history lacks it.
/// Runs on the links job thread, before the rewrite's mutation guard: clone + send only.
pub(super) fn before_rewrite(_vh: &VaultHistory, _path: &str) {}
