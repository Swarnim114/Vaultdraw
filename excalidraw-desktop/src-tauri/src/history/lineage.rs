//! Lineage identity: path records on in-app moves, relink after outside renames (M9),
//! multi-lineage paths (M10), trash with a 7-day hidden window (N1), orphan tracking.
//!
//! Contract frozen at the H3 skeleton (PLAN-H3.md §3); agent I implements the bodies.
use super::VaultHistory;

/// Per-vault lineage state persisted in `<state>/history/<vault-id>/lineages.json` (trash marks,
/// orphan-since times). Lives in `VaultHistory::lineage`; written on the worker only.
#[derive(Default, Debug)]
pub(crate) struct State {}

/// Hook (`move_entry`, `move_entry_with_links`): a file or folder moved inside the app.
pub(super) fn moved(_vh: &VaultHistory, _from: &str, _to: &str) {}

/// Hook (`trash_entry`): a file moved to the OS Trash from the app.
pub(super) fn trashed(_vh: &VaultHistory, _path: &str) {}

/// What the GC sweep may delete because of lineage state.
#[derive(Default, Debug)]
pub(super) struct SweepInputs {
    /// Orphaned (no current path on disk, not trashed) for ≥ 30 days: automatic versions go.
    pub orphaned: Vec<String>,
    /// Trashed more than 7 days ago and not re-attached: everything goes.
    pub trash_expired: Vec<String>,
}

pub(super) fn sweep_inputs(_vh: &VaultHistory, _now_ms: u64) -> SweepInputs {
    SweepInputs::default()
}

/// GC removed these lineages completely: drop their state.
pub(super) fn forget(_vh: &VaultHistory, _lineages: &[String]) {}
