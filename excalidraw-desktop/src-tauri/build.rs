use std::path::Path;

/// `bundle.externalBin` makes tauri-build require `binaries/vaultdraw-<triple>`.
/// `tauri build` creates the real CLI first (beforeBuildCommand runs
/// scripts/build-cli.mjs); plain `cargo check/test` and `tauri dev` get a stub
/// that explains how to build it, so they keep working without that step.
fn ensure_cli_sidecar() {
    let triple = std::env::var("TARGET").expect("cargo sets TARGET");
    let path = format!("binaries/vaultdraw-{triple}");
    println!("cargo:rerun-if-changed={path}");
    if Path::new(&path).exists() {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!("{path} is missing: run `node scripts/build-cli.mjs` first");
    }
    std::fs::create_dir_all("binaries").expect("create binaries/");
    std::fs::write(
        &path,
        "#!/bin/sh\necho 'vaultdraw: dev stub; run `node scripts/build-cli.mjs`' >&2\nexit 1\n",
    )
    .expect("write CLI stub");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("chmod CLI stub");
    }
}

fn main() {
    ensure_cli_sidecar();
    tauri_build::build()
}
