import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAppOnce } from "./app.mjs";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-app.mjs");
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "perf-test-"));
  const vault = path.join(root, "pristine");
  mkdirSync(vault);
  writeFileSync(path.join(vault, "a.excalidraw"), "{}");
  return { root, vault, runsDir: path.join(root, "runs") };
}

test("runAppOnce with fake binary: marks, rss, idle cpu, report merge, cleanup", async () => {
  const { vault, runsDir } = setup();
  const r = await runAppOnce({ appPath: "unused", binary: fake, pristineVault: vault, runsDir, sampleEveryMs: 100 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.samples["open.small"], [10, 12]);
  assert.ok(r.samples["startup.coldToInteractive"][0] >= 250);
  assert.ok(r.samples["memory.peakRssMB"][0] > 5);
  const cpu = r.samples["idle.cpuPercent"][0];
  assert.ok(cpu > 20 && cpu < 90, `idle cpu ${cpu}`);
  assert.deepEqual(r.marks.map((m) => m.name), ["interactive", "phase:open", "idle-begin", "idle-end"]);
  assert.equal(existsSync(path.join(runsDir)), true);
  assert.equal(r.runDir, undefined);
});

test("runAppOnce reports missing smoke-report", async () => {
  const { vault, runsDir } = setup();
  const r = await runAppOnce({ appPath: "unused", binary: fake, pristineVault: vault, runsDir, env: { FAKE_MODE: "noreport" } });
  assert.ok(r.errors.some((e) => /no smoke-report/.test(e)));
});

test("runAppOnce kills on timeout", async () => {
  const { vault, runsDir } = setup();
  const r = await runAppOnce({ appPath: "unused", binary: fake, pristineVault: vault, runsDir, timeoutMs: 1500, env: { FAKE_MODE: "hang" } });
  assert.ok(r.errors.some((e) => /timeout/.test(e)));
  assert.equal(r.samples["startup.coldToInteractive"]?.length, 1);
});
