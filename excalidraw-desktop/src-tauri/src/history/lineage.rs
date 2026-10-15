//! Path records on in-app moves, relink, trash (N1). Bodies arrive in H3; the hooks exist now.
use super::VaultHistory;

pub(super) fn moved(_vh: &VaultHistory, _from: &str, _to: &str) {}

pub(super) fn trashed(_vh: &VaultHistory, _path: &str) {}
