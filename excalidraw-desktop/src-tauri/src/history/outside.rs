//! Outside-change detection and `history_snapshot_bytes` (M15). Bodies arrive in H3.
use super::{SnapshotOutcome, VaultHistory};
use crate::{err, Result};

/// Watcher paths (vault entries) for outside-change detection.
pub(super) fn watched(_vh: &VaultHistory, _entries: &[String]) {}

pub(super) fn snapshot_bytes(_vh: &VaultHistory, _path: &str, _reason: &str, _revision: &str, _body: &[u8]) -> Result<SnapshotOutcome> {
    Err(err("HISTORY_OFF", "Snapshots of unsaved bytes are not available yet"))
}
