//! Deletes: thinning, size cap, own-blob sweep, takeover of dead devices' files, orphan sweep
//! (automatic versions only, M7), N1 trash expiry and the explicit deletes. Everything here runs
//! on the history worker thread (never on a command thread), so it can't race the writer.
//!
//! Contract frozen at the H3 skeleton (PLAN-H3.md §3); agent H implements the bodies.
use super::{HistorySettings, VaultHistory};
use crate::{err, Result};
use std::time::Duration;

/// What the last sweep found (shown in `history_status`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Report {
    /// "none" | "checkpoints" | "other-devices"
    pub over_cap: &'static str,
    /// A header the own-blob sweep needs could not be read (e.g. dataless): blobs were kept.
    pub gc_blocked: bool,
}

impl Default for Report {
    fn default() -> Self {
        Report { over_cap: "none", gc_blocked: false }
    }
}

/// What every GC entry point needs (built by the worker for each call).
pub(super) struct Ctx<'a> {
    pub vh: &'a VaultHistory,
    /// This device's id.
    pub dev: &'a str,
    pub now_ms: u64,
    pub settings: &'a HistorySettings,
}

/// Retention for one lineage right after a version was written to it (plus the cap when the
/// vault is over it). Must stay cheap: plan ≤ 50 µs, a handful of unlinks.
pub(super) fn after_write(_ctx: &Ctx, _lineage: &str) {}

/// The whole-vault sweep (daily and on vault open), resumable in chunks of `budget`.
pub(super) struct Sweep {
    done: bool,
}

impl Sweep {
    pub(super) fn new(_ctx: &Ctx) -> Sweep {
        Sweep { done: false }
    }
    /// Runs until `budget` is spent. Returns true when the sweep is finished.
    pub(super) fn step(&mut self, _ctx: &Ctx, _budget: Duration) -> bool {
        self.done = true;
        self.done
    }
}

/// Explicit user delete of one checkpoint (refused for anything that isn't a checkpoint).
pub(super) fn delete_checkpoint(_ctx: &Ctx, _id: &str) -> Result<()> {
    Err(err("HISTORY_OFF", "Deleting checkpoints is not available yet"))
}

/// "Delete all history of this drawing": every lineage of `path` (hidden ones too), every device,
/// checkpoints included. Returns the lineages removed.
pub(super) fn delete_all(_ctx: &Ctx, _path: &str) -> Result<Vec<String>> {
    Err(err("HISTORY_OFF", "Deleting history is not available yet"))
}

/// Deletes every file of these lineages (N1 trash expiry; checkpoints included).
pub(super) fn delete_lineages(_ctx: &Ctx, _lineages: &[String]) -> Result<()> {
    Ok(())
}
