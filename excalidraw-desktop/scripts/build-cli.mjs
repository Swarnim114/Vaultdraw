// Builds the `vaultdraw` CLI and copies it to src-tauri/binaries/vaultdraw-<target-triple>,
// where Tauri's bundle.externalBin expects it. Runs as part of beforeBuildCommand.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const manifest = join(tauriDir, "Cargo.toml");
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// Tauri sets TAURI_ENV_TARGET_TRIPLE for beforeBuildCommand (e.g. universal builds run per triple).
const hostTriple = run("rustc", ["-vV"]).match(/^host: (.+)$/m)?.[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple;
if (!triple) throw new Error("cannot determine the target triple from `rustc -vV`");

const cross = triple !== hostTriple;
execFileSync(
  "cargo",
  ["build", "--release", "-p", "vaultdraw-cli", "--manifest-path", manifest, ...(cross ? ["--target", triple] : [])],
  { stdio: "inherit" },
);

// Respects CARGO_TARGET_DIR and the workspace target directory.
const targetDir = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest])).target_directory;
const exe = triple.includes("windows") ? ".exe" : "";
const built = join(targetDir, ...(cross ? [triple] : []), "release", `vaultdraw${exe}`);
const outDir = join(tauriDir, "binaries");
const out = join(outDir, `vaultdraw-${triple}${exe}`);
mkdirSync(outDir, { recursive: true });
copyFileSync(built, out);
chmodSync(out, 0o755);
console.log(`vaultdraw CLI -> ${out}`);
