import test from "node:test";
import assert from "node:assert/strict";
import { parseLoadAvg, waitQuiet, loadNote, loadSummary } from "./load.mjs";

test("parseLoadAvg", () => {
  assert.equal(parseLoadAvg("{ 7.52 10.02 8.02 }\n"), 7.52);
  assert.ok(Number.isNaN(parseLoadAvg("")));
});

function fakeClock(samples) {
  let t = 0, i = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; }, sample: () => samples[Math.min(i++, samples.length - 1)] };
}

test("waitQuiet returns immediately when quiet", async () => {
  const r = await waitQuiet({ threshold: 3.5, waitS: 60, ...fakeClock([1.234]) });
  assert.deepEqual(r, { threshold: 3.5, waitedS: 0, quiet: true, start: 1.23, end: 1.23 });
});

test("waitQuiet waits until load drops", async () => {
  const r = await waitQuiet({ threshold: 3.5, waitS: 100, pollS: 10, ...fakeClock([8, 6, 2]) });
  assert.equal(r.quiet, true);
  assert.equal(r.waitedS, 20);
  assert.equal(r.start, 8);
  assert.equal(r.end, 2);
});

test("waitQuiet gives up after waitS; waitS 0 never waits", async () => {
  const r = await waitQuiet({ threshold: 3.5, waitS: 30, pollS: 10, ...fakeClock([9]) });
  assert.equal(r.quiet, false);
  assert.equal(r.waitedS, 30);
  const z = await waitQuiet({ threshold: 3.5, waitS: 0, ...fakeClock([9]) });
  assert.equal(z.waitedS, 0);
  assert.equal(z.quiet, false);
});

test("loadNote and summary", () => {
  assert.equal(loadNote({ threshold: 3.5, quiet: true, start: 1, end: 2, perRun: [2], waitedS: 0 }), null);
  assert.match(loadNote({ threshold: 3.5, quiet: true, start: 1, end: 2, perRun: [5], waitedS: 0 }), /peak 1-min load 5/);
  assert.match(loadSummary({ threshold: 3.5, quiet: false, start: 8, end: 7, perRun: [7], waitedS: 300 }), /NOT quiet/);
});
