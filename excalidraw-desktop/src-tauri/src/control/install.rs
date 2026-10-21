//! "Install the `vaultdraw` command": a symlink to the CLI binary shipped next to the app.

use std::path::{Path, PathBuf};

const SYSTEM_TARGET: &str = "/usr/local/bin/vaultdraw";

/// Symlinks the bundled CLI into `~/.local/bin` (or `/usr/local/bin` when `system`).
/// Returns the link path.
pub(crate) fn install_cli(system: bool) -> crate::Result<PathBuf> {
    let exe = std::env::current_exe().map_err(crate::ioerr)?;
    let src = exe.parent().map(|d| d.join("vaultdraw")).ok_or_else(|| crate::err("NOT_FOUND", "Cannot locate the app directory"))?;
    let target = if system {
        PathBuf::from(SYSTEM_TARGET)
    } else {
        let home = std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute());
        home.ok_or_else(|| crate::err("INVALID_PATH", "$HOME is not set"))?.join(".local/bin/vaultdraw")
    };
    install_link(&src, &target)?;
    Ok(target)
}

pub(crate) fn install_link(src: &Path, target: &Path) -> crate::Result<()> {
    if !src.exists() {
        return Err(crate::err(
            "NOT_FOUND",
            format!("The vaultdraw command line tool is not part of this build (expected {}); it ships in the packaged app", src.display()),
        ));
    }
    link(src, target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            crate::err(
                "READ_ONLY",
                format!("No permission to write {}. Run in a terminal: sudo ln -sf '{}' {}", target.display(), src.display(), target.display()),
            )
        } else if e.kind() == std::io::ErrorKind::AlreadyExists {
            crate::err("CONFLICT", format!("{} already exists and is not a symlink; remove it first", target.display()))
        } else {
            crate::ioerr(e)
        }
    })
}

#[cfg(unix)]
fn link(src: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    match std::fs::symlink_metadata(target) {
        Ok(m) if m.file_type().is_symlink() => std::fs::remove_file(target)?,
        Ok(_) => return Err(std::io::ErrorKind::AlreadyExists.into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    std::os::unix::fs::symlink(src, target)
}

#[cfg(not(unix))]
fn link(_src: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other("installing the command is only supported on macOS and Linux"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn creates_replaces_and_refuses_regular_files() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("vaultdraw");
        std::fs::write(&src, "bin").unwrap();
        let target = t.path().join("bin/vaultdraw");
        install_link(&src, &target).unwrap();
        assert_eq!(std::fs::read_link(&target).unwrap(), src);
        // An old symlink (e.g. to a moved app) is replaced.
        let other = t.path().join("other");
        std::fs::write(&other, "x").unwrap();
        std::fs::remove_file(&target).unwrap();
        std::os::unix::fs::symlink(&other, &target).unwrap();
        install_link(&src, &target).unwrap();
        assert_eq!(std::fs::read_link(&target).unwrap(), src);
        // A regular file is never overwritten.
        std::fs::remove_file(&target).unwrap();
        std::fs::write(&target, "mine").unwrap();
        assert_eq!(install_link(&src, &target).unwrap_err().code, "CONFLICT");
        assert_eq!(std::fs::read(&target).unwrap(), b"mine");
    }

    #[test]
    fn missing_source_is_not_found() {
        let t = tempfile::tempdir().unwrap();
        let e = install_link(&t.path().join("nope"), &t.path().join("l")).unwrap_err();
        assert_eq!(e.code, "NOT_FOUND");
    }

    #[test]
    fn permission_denied_gives_the_sudo_command() {
        if vaultdraw_protocol::peer::my_uid() == 0 {
            return;
        }
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("vaultdraw");
        std::fs::write(&src, "bin").unwrap();
        let dir = t.path().join("ro");
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
        let e = install_link(&src, &dir.join("vaultdraw")).unwrap_err();
        assert_eq!(e.code, "READ_ONLY");
        assert!(e.message.contains("sudo ln -sf '"), "{}", e.message);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
}
