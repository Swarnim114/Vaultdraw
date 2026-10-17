#!/usr/bin/env node
// Base-vs-head A/B perf gate (Chromium mode, interleaved base,head,base,head...). Wrap in the shared build lock:
//   lockf -k /Users/kalon/Opensource/excalidraw/.cache/build.lock node excalidraw-desktop/perf/ab.mjs --base main
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogue, unitOf } from "./lib/catalogue.mjs";
import { compare } from "./lib/compare.mjs";
import { comparisonTable } from "./lib/report.mjs";
import { waitQuiet, loadNote, loadSummary, DEFAULT_QUIET_LOAD, DEFAULT_QUIET_WAIT_S } from "./lib/load.mjs";
import { interleaveOrder, mergeSide, buildAbResult, ensureBaseWorktree, runOnce } from "./lib/ab.mjs";

const HELP = `Usage: node excalidraw-desktop/perf/ab.mjs --base <git-ref> [options]

Recommended merge gate: interleaves base, head, base, head... (Chromium mode, one run.mjs --runs 1 each) in one session,
so both sides see the same machine load, then compares head vs base with the catalogue rules (exit 1 on regression).
Two sides only; bisect across a batch only AFTER a confirmed regression.

  --base <ref>        base commit/branch (a detached worktree is created under <head>/.cache/perf/ab/base-<sha>)
  --head <path>       head worktree (default: this worktree)
  --pairs N           base/head pairs (default 1 = quick perf; confirm a regression with --pairs 3)
  --low-end           Chromium with CPU throttling x4
  --out <file>        head result JSON (run.mjs format + ab field; default <head>/.cache/perf/results/<ts>-ab-<mode>.json)
  --quiet-load X      quiet gate threshold, 1-min load (default ${DEFAULT_QUIET_LOAD}); runs once, before the first run
  --quiet-wait S      max seconds to wait for it (default ${DEFAULT_QUIET_WAIT_S}; 0 = don't wait)
  --require-quiet     exit 1 if the machine never got quiet

Wrap in the build lock: lockf -k /Users/kalon/Opensource/excalidraw/.cache/build.lock node excalidraw-desktop/perf/ab.mjs ...
`;

const { values: o } = parseArgs({
  options: {
    base: { type: "string" }, head: { type: "string" }, pairs: { type: "string" }, "low-end": { type: "boolean" }, out: { type: "string" },
    "quiet-load": { type: "string" }, "quiet-wait": { type: "string" }, "require-quiet": { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
});
if (o.help || !o.base) { console.log(HELP); process.exit(o.help ? 0 : 1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const headWt = path.resolve(o.head ?? path.join(here, "..", ".."));
const runMjs = path.join(here, "run.mjs");
const pairs = Number(o.pairs ?? 1);
const mode = o["low-end"] ? "low-end" : "normal";
const log = (m) => console.error(`[ab] ${m}`);
const t0 = Date.now();

const catalogue = loadCatalogue();
const load = await waitQuiet({
  threshold: o["quiet-load"] !== undefined ? Number(o["quiet-load"]) : DEFAULT_QUIET_LOAD,
  waitS: o["quiet-wait"] !== undefined ? Number(o["quiet-wait"]) : DEFAULT_QUIET_WAIT_S,
  log,
});
if (!load.quiet && o["require-quiet"]) {
  console.error(`[ab] machine not quiet: ${loadSummary(load)}; exiting (--require-quiet)`);
  process.exit(1);
}

const base = ensureBaseWorktree(headWt, o.base);
log(`base ${o.base} = ${base.sha.slice(0, 10)} at ${base.dir}`);
const fixturesDir = path.join(headWt, ".cache", "perf", "fixtures");
const scratch = path.join(headWt, ".cache", "perf", "ab", `run-${Date.now()}`);
mkdirSync(scratch, { recursive: true });

const results = { base: [], head: [] };
for (const step of interleaveOrder(pairs)) {
  const out = path.join(scratch, `${step.side}-${step.index}.json`);
  log(`${step.side} run ${step.index + 1}/${pairs}`);
  results[step.side].push(await runOnce({
    runMjs, wtRoot: step.side === "base" ? base.dir : headWt, fixturesDir, out, lowEnd: !!o["low-end"],
    // The first run per side builds its own browser bundle; later ones reuse it.
    build: step.index === 0, log,
  }));
}
load.end = results.head.at(-1)?.load?.end ?? load.end;

const unit = unitOf(catalogue);
const head = mergeSide(results.head, unit);
const baseSide = mergeSide(results.base, unit);
const lnote = loadNote({ ...load, perRun: [...head.perRunLoad, ...baseSide.perRunLoad] });
const result = buildAbResult({
  template: results.head.at(-1), head, base: baseSide, baseSha: base.sha, pairs, load,
  notes: [`A/B interleaved: base ${o.base} (${base.sha.slice(0, 10)}) vs head, ${pairs} pair(s)`, ...(lnote ? [lnote] : [])],
});

const cmp = compare(result, { metrics: baseSide.metrics }, catalogue);
console.log(`\nVaultdraw perf A/B - ${mode} - ${pairs} pair(s) - head ${String(result.git?.sha).slice(0, 10)} vs base ${base.sha.slice(0, 10)}`);
console.log(comparisonTable(cmp.rows));
console.log(loadSummary(result.load));
for (const n of result.notes) console.log(`note: ${n}`);
if (cmp.failing.length) console.log(`\nFAIL: ${cmp.failing.map((r) => `${r.metric}.${r.stat} (${r.status})`).join(", ")}`);
if (cmp.failing.length && pairs < 3) console.log(`hint: only ${pairs} pair(s); confirm with --pairs 3 before calling this a regression (prefer the browser.cpu.* / browser.count.* rows)`);
if (result.errors.length) console.log(`\nERRORS:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`);

const outFile = o.out ? path.resolve(o.out) : path.join(headWt, ".cache", "perf", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-ab-${mode}.json`);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
console.log(`\nresult: ${outFile}\nelapsed: ${((Date.now() - t0) / 60000).toFixed(1)} min`);
process.exit(cmp.exitCode || result.errors.length ? 1 : 0);
