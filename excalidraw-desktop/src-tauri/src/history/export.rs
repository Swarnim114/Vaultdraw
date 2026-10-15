//! Restore-as-copy, Save-as export, git exclusion. Bodies arrive in H2 (copy/export) and H3 (git).
use super::VaultHistory;
use crate::{err, Result};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredCopy {
    pub path: String,
    pub revision: String,
}

pub(super) fn restore_copy(_vh: &VaultHistory, _id: &str) -> Result<RestoredCopy> {
    Err(err("HISTORY_OFF", "Restore as copy is not available yet"))
}

pub(super) fn export_file(_vh: &VaultHistory, _id: &str) -> Result<bool> {
    Err(err("HISTORY_OFF", "Export is not available yet"))
}

pub(super) fn exclude_from_git(_vh: &VaultHistory) -> Result<()> {
    Err(err("HISTORY_OFF", "Excluding history from git is not available yet"))
}
