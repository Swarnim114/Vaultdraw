#!/bin/sh
# Runs the packaged smoke app (built with --features smoke-test) twice against the
# same config + vault dirs to prove the library persists across a restart, then a
# third time under taskpolicy -c background (low-end; milestones only, SMOKE_LOWEND=1). Prints each report summary.
# Usage: [SMOKE_LOWEND=1] scripts/library-smoke.sh   (run from anywhere; holds the shared build lock)
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
WT=$(cd "$HERE/.." && pwd)
LOCK=/Users/kalon/Opensource/excalidraw/.cache/build.lock
APP="$HERE/src-tauri/target/release/bundle/macos/Excalidraw Vault.app/Contents/MacOS/excalidraw-vault"
T=$(date +%s); D="$WT/.cache/smoke-run-$T"; C="$WT/.cache/smoke-config-$T"
mkdir -p "$D" "$C/config/themes/Test Palette" "$C/state"
printf '{\n  "dark": { "mSurface": "#1b2b34", "mOnSurface": "#d8dee9", "mPrimary": "#ec5f67" }\n}\n' > "$C/config/themes/Test Palette/Test Palette.json"
echo "D=$D C=$C"
caffeinate -d -i -t 3600 & CAF=$!   # keep the display awake so requestAnimationFrame keeps firing
run() { # label, prefix...
  label=$1; shift
  rm -f "$D/smoke-report.json"
  # The suite is not idempotent in one vault (its "nested" lookup would pick the previous
  # run's folder); drop earlier suite folders, keep the vault's library.excalidrawlib.
  rm -rf "$D"/smoke-suite-*
  start=$(date +%s)
  # perl alarm: a hung WebView (rAF stops when the window is occluded) must not hold the lock forever.
  lockf -k "$LOCK" env EXCALIDRAW_VAULT_SMOKE_DIR="$D" VAULTDRAW_CONFIG_DIR="$C/config" VAULTDRAW_STATE_DIR="$C/state" "$@" perl -e 'alarm 420; exec {$ARGV[0]} @ARGV' "$APP"
  echo "== $label: exit=$? wall=$(( $(date +%s) - start ))s"
  cp "$D/smoke-report.json" "$D/smoke-report-$label.json" 2>/dev/null
  node -e '
const r=require(process.argv[1]);const a=r.details||r;
console.log("status",r.status,"elapsedMs",a.elapsedMs);
for(const s of a.records||r.steps){if(!s.ok||/^library/.test(s.step))console.log(s.ok?"ok  ":"FAIL",s.step,JSON.stringify(s.details).slice(0,400))}
const f=(a.records||[]).filter(s=>!s.ok);console.log("failed steps:",f.length,"pageErrors:",(a.pageErrors||[]).length)' "$D/smoke-report-$label.json"
}
run run1 env
run run2 env
[ "${SMOKE_LOWEND:-0}" = 1 ] && run run3-lowend taskpolicy -c background
ls -la "$C/config/library.excalidrawlib" "$D/library.excalidrawlib"
kill $CAF 2>/dev/null
