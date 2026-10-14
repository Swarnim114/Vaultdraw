import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureTypicalVault, ensureAltVault, planPaths, ALT_MARKER } from "./extraVaults.mjs";

const config = JSON.parse(readFileSync(new URL("../typical.config.json", import.meta.url), "utf8"));

function walk(dir, rel = "") {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, p) : e.name.endsWith(".excalidraw") ? [p] : [];
  });
}

test("planPaths is deterministic, unique and honours reserved names", () => {
  const a = planPaths(1, { A: 5, B: 3 }, 2, ["A/x.excalidraw"]);
  const b = planPaths(1, { A: 5, B: 3 }, 2, ["A/x.excalidraw"]);
  assert.deepEqual(a, b);
  assert.equal(a.length, 10);
  assert.equal(new Set(a.map((p) => p.rel.toLowerCase())).size, 10);
  assert.equal(a.filter((p) => p.dir === "").length, 2);
});

test("typical vault: 50 drawings in the configured folders, one 300-element target with 2 images (~1-2 MB total)", async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "typical-"));
  const { vaultDir, manifest } = await ensureTypicalVault({ cacheDir, config });
  const files = walk(vaultDir);
  assert.equal(files.length, 50);
  assert.equal(manifest.drawingCount, 50);
  for (const [folder, n] of Object.entries(config.folders)) {
    const inFolder = files.filter((f) => path.posix.dirname(f) === folder).length;
    assert.equal(inFolder, folder === path.posix.dirname(config.target.path) ? n + 1 : n, folder);
  }
  assert.equal(files.filter((f) => !f.includes("/")).length, config.rootDrawings);
  const target = JSON.parse(readFileSync(path.join(vaultDir, config.target.path), "utf8"));
  assert.equal(target.elements.length, 300);
  assert.equal(Object.keys(target.files).length, 2);
  assert.equal(target.elements.filter((e) => e.type === "image").length, 2);
  const mb = statSync(path.join(vaultDir, config.target.path)).size / 1048576;
  assert.ok(mb > 1 && mb < 2, `target is ${mb.toFixed(2)} MB`);
  // Cached on the second call, identical bytes after a rebuild in another cache.
  const again = await ensureTypicalVault({ cacheDir, config });
  assert.equal(again.vaultDir, vaultDir);
  const other = await ensureTypicalVault({ cacheDir: mkdtempSync(path.join(tmpdir(), "typical-")), config });
  assert.equal(readFileSync(path.join(other.vaultDir, config.target.path), "utf8"), readFileSync(path.join(vaultDir, config.target.path), "utf8"));
  assert.deepEqual(walk(other.vaultDir), files);
});

test("alt vault: marker at the root plus a few small drawings, deterministic", async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "alt-"));
  const { vaultDir, manifest } = await ensureAltVault({ cacheDir, seed: 7 });
  const files = walk(vaultDir);
  assert.ok(files.includes(ALT_MARKER));
  assert.equal(files.length, manifest.drawingCount);
  assert.ok(files.length > 5 && files.length < 40);
  const other = await ensureAltVault({ cacheDir: mkdtempSync(path.join(tmpdir(), "alt-")), seed: 7 });
  assert.deepEqual(walk(other.vaultDir), files);
});
