#!/usr/bin/env node
// Usage: node excalidraw-desktop/perf/generate-fixtures.mjs [--cache-dir <dir>]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureVault } from "./lib/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const i = args.indexOf("--cache-dir");
const cacheDir = path.resolve(
  i >= 0 && args[i + 1] ? args[i + 1] : path.join(worktreeRoot, ".cache", "perf", "fixtures"),
);
const config = JSON.parse(readFileSync(path.join(here, "fixtures.config.json"), "utf8"));

const started = Date.now();
const { vaultDir, manifest } = await ensureVault({ cacheDir, config });
console.log(`vaultDir: ${vaultDir}`);
console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`drawings: ${manifest.drawingCount} (+${manifest.totalDrawingFiles - manifest.drawingCount} targets), folders: ${manifest.folders}, total: ${(manifest.totalBytes / 1048576).toFixed(1)} MiB`);
for (const [k, v] of Object.entries(manifest.openTargets)) console.log(`open.${k}: ${v.path} ${v.bytes} B, ${v.elements} elements, ${v.images} images`);
for (const h of manifest.imageHeavy) console.log(`imageHeavy: ${h.path} ${h.bytes} B, ${h.elements} elements, ${h.images} images`);
console.log(`searchQueries: ${JSON.stringify(manifest.searchQueries)}`);
