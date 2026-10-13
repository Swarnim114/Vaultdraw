import test from "node:test";
import assert from "node:assert/strict";
import { parsePsTime, parsePsSample, parsePsList, isWebKitHelper, sampleProcs } from "./procs.mjs";
import { parseSmokeLine } from "./app.mjs";

test("ps time formats", () => {
  assert.equal(parsePsTime("0:00.01"), 0.01);
  assert.equal(parsePsTime("1:02.50"), 62.5);
  assert.equal(parsePsTime("1:02:03.25"), 3723.25);
  assert.equal(parsePsTime("2-03:04:05.00"), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.ok(Number.isNaN(parsePsTime("garbage")));
});

test("ps parsers", () => {
  const s = parsePsSample("  101  20480   0:01.50\n  102   1024 12:00.00\n");
  assert.deepEqual(s.get(101), { rssKB: 20480, cpuSec: 1.5 });
  assert.equal(s.get(102).cpuSec, 720);
  const l = parsePsList(" 5 1 /Applications/My App.app/Contents/MacOS/x y\n 6 5 /S/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU\n");
  assert.equal(l[0].comm, "/Applications/My App.app/Contents/MacOS/x y");
  assert.equal(isWebKitHelper(l[1]), true);
  assert.equal(isWebKitHelper(l[0]), false);
});

test("sampleProcs on this process", async () => {
  const m = await sampleProcs([process.pid, 99998]);
  assert.ok(m.get(process.pid).rssKB > 0);
  assert.equal(m.has(99998), false);
});

test("mark line parsing", () => {
  const line = 'VAULTDRAW_SMOKE_LOG {"step":"perf-mark","ok":true,"details":{"name":"interactive","wallMs":5,"perfMs":1}}';
  assert.equal(parseSmokeLine(line).details.name, "interactive");
  assert.equal(parseSmokeLine("some other log"), null);
  assert.equal(parseSmokeLine("VAULTDRAW_SMOKE_LOG {broken"), null);
  assert.equal(parseSmokeLine("2026 INFO " + line).details.wallMs, 5);
});
