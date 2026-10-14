#!/usr/bin/env node
// Fake app for runAppOnce tests: prints marks, burns a little CPU, writes smoke-report.json, exits.
import { writeFileSync } from "node:fs";
import path from "node:path";
const dir = process.env.EXCALIDRAW_VAULT_SMOKE_DIR;
const mark = (name) => console.log(`VAULTDRAW_SMOKE_LOG ${JSON.stringify({ step: "perf-mark", ok: true, details: { name, wallMs: Date.now(), perfMs: performance.now() } })}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.env.FAKE_MODE ?? "ok";
await sleep(300);
mark("interactive");
if (mode === "hang") await sleep(60_000);
mark("phase:open");
if (mode === "leak") for (const label of ["baseline", "after-10", "after-vault-switch", "idle-after"]) { mark(`leak:${label}`); await sleep(500); }
mark("idle-begin");
const end = Date.now() + 1000; // ~50% busy for 1 s
while (Date.now() < end) { const t = Date.now() + 25; while (Date.now() < t); await sleep(25); }
mark("idle-end");
await sleep(600);
if (mode !== "noreport") {
  writeFileSync(path.join(dir, "smoke-report.json"), JSON.stringify({ status: 0, steps: [], details: { perf: { version: 1, env: "tauri", samples: { "open.small": [10, 12] }, info: { fake: true }, errors: [] } } }));
}
