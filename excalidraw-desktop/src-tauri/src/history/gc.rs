//! Deletes (thinning, cap, orphan sweep, trash expiry, explicit deletes). Bodies arrive in H3.
use super::VaultHistory;
use crate::{err, Result};

pub(super) fn delete_checkpoint(_vh: &VaultHistory, _id: &str) -> Result<()> {
    Err(err("HISTORY_OFF", "Deleting checkpoints is not available yet"))
}

pub(super) fn delete_all(_vh: &VaultHistory, _path: &str) -> Result<()> {
    Err(err("HISTORY_OFF", "Deleting history is not available yet"))
}
