#!/usr/bin/env node
// Perf harness CLI. Callers wrap the whole command in the shared build lock:
//   lockf -k /Users/kalon/Opensource/excalidraw/.cache/build.lock node excalidraw-desktop/perf/run.mjs ...
// This runner never takes the lock itself (nested lockf would deadlock).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCatalogue, specFor, unitOf } from "./lib/catalogue.mjs";
import { aggregate } from "./lib/stats.mjs";
import { compare, pickBaseline } from "./lib/compare.mjs";
import { buildPerfApp, reuseBuiltApp, runAppOnce, gitInfo, perfCacheDir, isScreenLocked } from "./lib/app.mjs";
import { machineInfo, resultTable, comparisonTable, updateBaseline } from "./lib/report.mjs";

const HELP = `Usage: node excalidraw-desktop/perf/run.mjs [options]

  --low-end              packaged app under taskpolicy -c background (+ WebKit helpers clamped), memory_pressure -S on
  Default (between milestones): Chromium mode only (headless, no windows), 2 runs, no warmup, no extra noise runs.
  --app                  also measure the packaged app (opens app windows; 2 runs)
  --milestone            full gate: packaged app + Chromium, 4 runs + 1 warmup, up to 2 extra runs when noisy
  --runs N               measured runs (default 2; 4 with --milestone), after --warmup (default 0; 1 with --milestone)
  --warmup N             warmup runs to discard
  --compare <file>       gate against a baseline (single result or combined {modes:{normal,"low-end"}}); exit 1 on regression
  --out <file>           result JSON (default <wt>/.cache/perf/results/<timestamp>-<mode>.json)
  --update-baseline <f>  merge this result into modes[mode] of combined file <f> (+ sibling .md)
  --no-build             reuse <wt>/.cache/perf/app/Excalidraw Vault.app
  --skip-browser         skip Chromium mode (lib/browser.mjs; skipped automatically if absent)
  --skip-app             skip the packaged-app mode
  --memory-pressure      run 'memory_pressure -S' (simulated; needs root, else noted and ignored) in normal mode too
  --keep-runs            keep per-run vault clones under .cache/perf/runs
  PERF_MEM_TIMELINE=1    (env) note per-process footprint at every phase boundary
  --quick                1 run, no warmup, no extra noise runs (harness smoke test)

The runner does not take the build lock. Wrap the whole command:
  lockf -k /Users/kalon/Opensource/excalidraw/.cache/build.lock node excalidraw-desktop/perf/run.mjs [options]
`;

const { values: o } = parseArgs({
  options: {
    "low-end": { type: "boolean" }, runs: { type: "string" }, warmup: { type: "string" }, compare: { type: "string" },
    out: { type: "string" }, "update-baseline": { type: "string" }, "no-build": { type: "boolean" },
    "skip-browser": { type: "boolean" }, "skip-app": { type: "boolean" }, "memory-pressure": { type: "boolean" },
    "keep-runs": { type: "boolean" }, quick: { type: "boolean" }, app: { type: "boolean" }, milestone: { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
});
if (o.help) { console.log(HELP); process.exit(0); }

const here = path.dirname(fileURLToPath(import.meta.url));
const wtRoot = path.resolve(here, "..", "..");
const cacheDir = perfCacheDir(wtRoot);
const mode = o["low-end"] ? "low-end" : "normal";
const runs = o.quick ? 1 : Number(o.runs ?? (o.milestone ? 4 : 2));
const warmup = o.quick ? 0 : Number(o.warmup ?? (o.milestone ? 1 : 0));
// Packaged-app runs open windows on the user's screen: only on request or at milestones.
const skipApp = !!o["skip-app"] || !(o.app || o.milestone);
const log = (m) => console.error(`[perf] ${m}`);
const t0 = Date.now();
const elapsedMin = () => (Date.now() - t0) / 60000;

const catalogue = loadCatalogue();
const config = JSON.parse(readFileSync(path.join(here, "fixtures.config.json"), "utf8"));
const errors = [];
const notes = [];
const rawApp = [];
let rawBrowser = [];
let git = gitInfo(wtRoot);
let fixtureHash = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);

// Keep the display awake (and the session from idle-locking) for the whole run: a locked or
// sleeping screen hides the WebView, which stops requestAnimationFrame in the packaged app.
try {
  spawn("caffeinate", ["-dimsu", "-t", "7200", "-w", String(process.pid)], { stdio: "ignore", detached: false }).on("error", () => {});
} catch { /* best effort */ }
const LOCKED_MSG = "screen is locked: the packaged app can't be measured (WebKit stops rendering hidden windows). Unlock the screen, or use --skip-app for Chromium-only numbers";

const gatedNoisy = (metrics) => Object.entries(metrics).some(([id, m]) => m.noisy && specFor(catalogue, id));

// ---- app mode ----
let appTarget = null;
if (!skipApp && isScreenLocked()) {
  errors.push(`app mode: ${LOCKED_MSG}`);
  log(`app mode skipped: ${LOCKED_MSG}`);
} else if (!skipApp) {
  try {
    const { ensureVault } = await import(pathToFileURL(path.join(here, "lib", "fixtures.mjs")).href);
    const { vaultDir, manifest } = await ensureVault({ cacheDir: path.join(cacheDir, "fixtures"), config, log });
    if (manifest?.hash) fixtureHash = String(manifest.hash).slice(0, 12);
    const built = o["no-build"] ? reuseBuiltApp({ wtRoot }) : await buildPerfApp({ wtRoot, log });
    git = built.git ?? git;
    appTarget = {
      runOne: async (i) => {
        const r = await runAppOnce({
          appPath: built.appPath, pristineVault: vaultDir, lowEnd: mode === "low-end", runIndex: i,
          keepRuns: !!o["keep-runs"], memoryPressure: mode === "low-end" || !!o["memory-pressure"], log,
        });
        for (const n of r.notes) if (!notes.includes(n)) notes.push(n);
        return r;
      },
    };
  } catch (e) {
    errors.push(`app mode: ${e.message}`);
    log(`app mode failed: ${e.message}`);
  }
}

async function collectApp(count, label) {
  for (let i = 0; i < count; i++) {
    if (isScreenLocked()) {
      errors.push(`app run: ${LOCKED_MSG}`);
      log(`app run aborted: ${LOCKED_MSG}`);
      return;
    }
    log(`app ${label} run ${i + 1}/${count} (${mode})`);
    let r = await appTarget.runOne(rawApp.length + i + (label === "warmup" ? 1000 : 0));
    if (r.errors.length) {
      // One retry: other sessions launch apps with the same bundle id and can quit ours from outside.
      const why = r.errors.join("; ");
      log(`app run failed (${why}); retrying once`);
      notes.push(`app ${label} run retried after: ${why}`);
      r = await appTarget.runOne(rawApp.length + i + 2000);
    }
    if (label === "warmup") continue;
    if (r.errors.length) errors.push(...r.errors.map((e) => `app run: ${e}`));
    if (Object.keys(r.samples).length) rawApp.push(r.samples);
    if (r.info?.memoryTimeline) notes.push(`memory timeline (MB, now/peak per process): ${r.info.memoryTimeline.map((t) => `${t.mark} ${Object.entries(t.procs).map(([k, v]) => `${k}=${v.now}/${v.peak}`).join(" ")}`).join(" | ")}`);
  }
}

if (appTarget) {
  await collectApp(warmup, "warmup");
  await collectApp(runs, "measured");
  let extra = 0;
  while (o.milestone && !o.quick && extra < 2 && rawApp.length && elapsedMin() < 5.5 && gatedNoisy(aggregate(rawApp, unitOf(catalogue)))) {
    extra++;
    log(`noisy gated metric(s); extra run ${extra}/2 (${elapsedMin().toFixed(1)} min elapsed)`);
    await collectApp(1, "measured");
  }
  if (extra) notes.push(`${extra} extra app run(s) added because of noise`);
}

// ---- browser mode ----
if (!o["skip-browser"]) {
  const bf = path.join(here, "lib", "browser.mjs");
  if (!existsSync(bf)) {
    notes.push("browser mode skipped: lib/browser.mjs not present");
  } else {
    try {
      const { runBrowser } = await import(pathToFileURL(bf).href);
      const { ensureVault } = await import(pathToFileURL(path.join(here, "lib", "fixtures.mjs")).href);
      const { vaultDir } = await ensureVault({ cacheDir: path.join(cacheDir, "fixtures"), config, log });
      // runBrowser discards its own warmup runs and returns only measured ones.
      const r = await runBrowser({ mode, runs, warmup, vaultDir, config, build: !o["no-build"], log });
      for (const e of r.errors ?? []) errors.push(`browser mode: ${e}`);
      rawBrowser = (r.samplesPerRun ?? []).map((run) =>
        Object.fromEntries(Object.entries(run).map(([k, v]) => [k.startsWith("browser.") ? k : `browser.${k}`, v])));
      if (r.info) notes.push(`browser info: ${JSON.stringify(r.info)}`);
    } catch (e) {
      errors.push(`browser mode: ${e.message}`);
    }
  }
}

const metrics = {
  ...aggregate(rawApp, unitOf(catalogue)),
  ...aggregate(rawBrowser, unitOf(catalogue)),
};
for (const [id, m] of Object.entries(metrics)) if (!specFor(catalogue, id)) notes.push(`uncatalogued metric ${id} (not gated)`);
const noisyIds = Object.entries(metrics).filter(([id, m]) => m.noisy && specFor(catalogue, id)).map(([id]) => id);
if (noisyIds.length) notes.push(`still noisy: ${noisyIds.join(", ")}`);

const result = {
  version: 1, mode, createdAt: new Date().toISOString(), git, machine: machineInfo(),
  config: { runs: rawApp.length || rawBrowser.length, warmup, fixtureHash, drawingCount: config.drawingCount },
  metrics, raw: { app: rawApp, browser: rawBrowser }, notes, errors,
};

const outFile = o.out ? path.resolve(o.out) : path.join(cacheDir, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}.json`);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");

console.log(`\nVaultdraw perf - ${mode} - ${rawApp.length || rawBrowser.length} measured run(s) + ${warmup} warmup - ${git.sha.slice(0, 10)}${git.dirty ? " (dirty)" : ""}`);
console.log(resultTable(result, catalogue));
for (const n of notes) console.log(`note: ${n}`);

let exitCode = 0;
if (o.compare) {
  const { baseline, warnings } = pickBaseline(JSON.parse(readFileSync(o.compare, "utf8")), mode, result.machine);
  for (const w of warnings) console.log(`WARNING: ${w}`);
  const cmp = compare(result, baseline, catalogue);
  console.log(`\nComparison vs ${o.compare}`);
  console.log(comparisonTable(cmp.rows));
  const pre = cmp.rows.filter((r) => r.status === "budget-preexisting");
  if (pre.length) console.log(`\nWARNING: ${pre.length} budget breach(es) already present in the baseline (not failing): ${pre.map((r) => `${r.metric}.${r.stat}`).join(", ")}`);
  if (cmp.failing.length) console.log(`\nFAIL: ${cmp.failing.map((r) => `${r.metric}.${r.stat} (${r.status})`).join(", ")}`);
  exitCode = cmp.exitCode;
}
if (o["update-baseline"] && errors.length) {
  console.log(`\nbaseline NOT updated: this run had errors (a baseline must come from a clean run)`);
} else if (o["update-baseline"]) {
  const r = updateBaseline(path.resolve(o["update-baseline"]), result, catalogue);
  console.log(`baseline updated: ${r.file} (+ ${r.md})`);
}
if (errors.length) {
  console.log(`\nERRORS:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  exitCode = 1;
}
console.log(`\nresult: ${outFile}\nelapsed: ${elapsedMin().toFixed(1)} min`);
process.exit(exitCode);
