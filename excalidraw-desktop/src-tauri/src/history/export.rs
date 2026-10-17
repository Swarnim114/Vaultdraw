//! Restore-as-copy and Save-as export (git exclusion lives in git.rs).
mod copy;

use super::VaultHistory;
use crate::Result;
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
