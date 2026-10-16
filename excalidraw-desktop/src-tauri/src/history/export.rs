//! Restore-as-copy, Save-as export, git exclusion. Bodies arrive in H2 (copy/export) and H3 (git).
mod copy;

use super::VaultHistory;
use crate::{err, Result};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredCopy {
    pub path: String,
    pub revision: String,
}

pub(super) fn restore_copy(vh: &VaultHistory, id: &str) -> Result<RestoredCopy> {
    copy::restore_copy(vh, id)
}

pub(super) fn export_file(vh: &VaultHistory, id: &str) -> Result<bool> {
    copy::export_file(vh, id)
}

pub(super) fn exclude_from_git(_vh: &VaultHistory) -> Result<()> {
    Err(err("HISTORY_OFF", "Excluding history from git is not available yet"))
}
