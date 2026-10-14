import test from "node:test";
import assert from "node:assert/strict";
import { parsePsTime, parsePsSample, parsePsList, isWebKitHelper, sampleProcs, parseFootprintJson, sampleFootprint } from "./procs.mjs";
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

test("footprint json parsing (real `footprint -j` shape)", () => {
  const text = JSON.stringify({
    unit: "byte", "bytes per unit": 1,
    processes: [
      { name: "excalidraw-vault", pid: 92516, "page size": 16384, footprint: 72074512,
        categories: {}, auxiliary: { phys_footprint_peak: 221152552, phys_footprint: 72107280 } },
      { name: "com.apple.WebKit.WebContent", pid: 92600, footprint: 1000, auxiliary: { phys_footprint_peak: 3000 } },
      { name: "broken", footprint: 5 },
    ],
  });
  const m = parseFootprintJson(text);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get(92516), { footprint: 72107280, peak: 221152552 });
  assert.deepEqual(m.get(92600), { footprint: 1000, peak: 3000 });
  assert.equal(parseFootprintJson("not json").size, 0);
});

test("sampleFootprint on this process", async () => {
  const m = await sampleFootprint([process.pid]);
  assert.ok(m.get(process.pid).footprint > 0);
  assert.ok(m.get(process.pid).peak >= m.get(process.pid).footprint * 0.5);
});
