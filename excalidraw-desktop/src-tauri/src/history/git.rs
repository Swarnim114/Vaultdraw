//! "Exclude history from git" (N2): adds `.excalidraw-vault/history/` to the vault's `.gitignore`,
//! only when the user clicks the button (never automatically). Idempotent, create-or-append,
//! the existing content is kept byte for byte.
use super::VaultHistory;
use crate::{err, ioerr, Result};
use std::{fs, io::Write, path::Path};

/// The line we add (a directory pattern relative to the vault root).
pub(crate) const IGNORE_LINE: &str = "/.excalidraw-vault/history/";
const MAX_GITIGNORE_BYTES: u64 = 1024 * 1024;

pub(crate) fn is_git_repo(root: &Path) -> bool {
    root.join(".git").exists()
}

/// A line that already ignores the history folder (or the whole meta folder).
fn covers(line: &str) -> bool {
    let l = line.trim();
    if l.starts_with('#') || l.starts_with('!') {
        return false;
    }
    let l = l.trim_start_matches('/').trim_end_matches("/**").trim_end_matches('/');
    l == ".excalidraw-vault/history" || l == ".excalidraw-vault"
}

/// `.gitignore` at the vault root already excludes the history folder.
pub(crate) fn is_excluded(root: &Path) -> bool {
    let p = root.join(".gitignore");
    match fs::symlink_metadata(&p) {
        Ok(m) if m.is_file() && m.len() <= MAX_GITIGNORE_BYTES => fs::read_to_string(&p).is_ok_and(|s| s.lines().any(covers)),
        _ => false,
    }
}

pub(crate) fn exclude(root: &Path) -> Result<()> {
    if !is_git_repo(root) {
        return Err(err("INVALID_ARGUMENT", "This vault is not a git repository"));
    }
    if is_excluded(root) {
        return Ok(());
    }
    let p = root.join(".gitignore");
    let existing = match fs::symlink_metadata(&p) {
        Ok(m) if m.file_type().is_symlink() || !m.is_file() => return Err(err("INVALID_PATH", ".gitignore is not a regular file")),
        Ok(m) if m.len() > MAX_GITIGNORE_BYTES => return Err(err("INVALID_FILE", ".gitignore is too large")),
        Ok(_) => fs::read(&p).map_err(ioerr)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(ioerr(e)),
    };
    let mut add = String::new();
    if !existing.is_empty() && !existing.ends_with(b"\n") {
        add.push('\n');
    }
    add.push_str("# Vaultdraw file history (per-device versions; synced, not for git)\n");
    add.push_str(IGNORE_LINE);
    add.push('\n');
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&p).map_err(ioerr)?;
    f.write_all(add.as_bytes()).map_err(ioerr)?;
    f.sync_all().map_err(ioerr)
}

pub(super) fn exclude_from_git(vh: &VaultHistory) -> Result<()> {
    if vh.flags.read_only.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(err("HISTORY_READ_ONLY", "History is read-only in this window"));
    }
    exclude(&vh.root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_outside_git_and_appends_once_keeping_content() {
        let d = tempfile::tempdir().unwrap();
        assert!(exclude(d.path()).is_err());
        fs::create_dir(d.path().join(".git")).unwrap();
        fs::write(d.path().join(".gitignore"), "node_modules").unwrap();
        assert!(!is_excluded(d.path()));
        exclude(d.path()).unwrap();
        exclude(d.path()).unwrap();
        let s = fs::read_to_string(d.path().join(".gitignore")).unwrap();
        assert!(s.starts_with("node_modules\n# Vaultdraw"));
        assert_eq!(s.matches(IGNORE_LINE).count(), 1);
        assert!(is_excluded(d.path()));
    }

    #[test]
    fn creates_the_file_and_recognises_existing_patterns() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join(".git")).unwrap();
        exclude(d.path()).unwrap();
        assert!(is_excluded(d.path()));
        for line in [".excalidraw-vault/", "/.excalidraw-vault/history", ".excalidraw-vault/history/**"] {
            fs::write(d.path().join(".gitignore"), format!("{line}\n")).unwrap();
            assert!(is_excluded(d.path()), "{line}");
        }
        for line in ["# .excalidraw-vault/history/", "!.excalidraw-vault/history/", "history/"] {
            fs::write(d.path().join(".gitignore"), format!("{line}\n")).unwrap();
            assert!(!is_excluded(d.path()), "{line}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlinked_gitignore() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join(".git")).unwrap();
        fs::write(d.path().join("elsewhere"), "x\n").unwrap();
        std::os::unix::fs::symlink(d.path().join("elsewhere"), d.path().join(".gitignore")).unwrap();
        assert!(exclude(d.path()).is_err());
        assert_eq!(fs::read_to_string(d.path().join("elsewhere")).unwrap(), "x\n");
    }
}
