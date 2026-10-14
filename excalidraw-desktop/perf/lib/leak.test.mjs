import test from "node:test";
import assert from "node:assert/strict";
import { drawingsAt, slope, leakSummary, leakTableText, totalMB } from "./leak.mjs";

const cp = (label, app, web, gpu = 10) => ({ label, procs: { app, webContent: web, gpu } });
const series = [
  cp("baseline", 100, 200),
  cp("after-10", 105, 220),
  cp("after-20", 110, 240),
  cp("after-30", 115, 260),
  cp("after-40", 120, 280),
  cp("after-50", 125, 300),
  cp("after-vault-switch", 110, 250),
  cp("after-vault-return", 112, 255),
  cp("idle-after", 112, 255),
];

test("drawingsAt", () => {
  assert.equal(drawingsAt("baseline"), 0);
  assert.equal(drawingsAt("after-30"), 30);
  assert.equal(drawingsAt("after-vault-switch"), null);
  assert.equal(drawingsAt("idle-after"), null);
});

test("slope: exact line, degenerate input", () => {
  assert.equal(slope([[0, 1], [1, 3], [2, 5]]), 2);
  assert.ok(Number.isNaN(slope([[1, 1]])));
  assert.ok(Number.isNaN(slope([[2, 1], [2, 5]])));
});

test("leakSummary: total and per process growth, per-ten slope, switch delta", () => {
  const { samples, rows, notes } = leakSummary(series);
  assert.deepEqual(notes, []);
  assert.deepEqual(samples["memory.leak.growthMB"], [totalMB(series.at(-1).procs) - totalMB(series[0].procs)]);
  assert.deepEqual(samples["memory.leak.growthMB"], [67]);
  assert.deepEqual(samples["memory.leak.growthMB.app"], [12]);
  assert.deepEqual(samples["memory.leak.growthMB.webContent"], [55]);
  assert.deepEqual(samples["memory.leak.growthMB.gpu"], [0]);
  // +5 app, +20 webContent per 10 drawings
  assert.deepEqual(samples["memory.leak.perTenDrawingsMB"], [25]);
  // after-vault-switch (370) minus after-50 (435)
  assert.deepEqual(samples["memory.leak.switchDeltaMB"], [-65]);
  assert.equal(rows.length, series.length);
});

test("leakSummary: a flat series has zero slope; missing checkpoints are reported, not thrown", () => {
  const flat = [cp("baseline", 100, 200), cp("after-10", 100, 200), cp("after-20", 100, 200), cp("idle-after", 100, 200)];
  const { samples } = leakSummary(flat);
  assert.deepEqual(samples["memory.leak.perTenDrawingsMB"], [0]);
  assert.deepEqual(samples["memory.leak.growthMB"], [0]);
  assert.equal(samples["memory.leak.switchDeltaMB"], undefined);
  const partial = leakSummary([cp("baseline", 1, 1)]);
  assert.deepEqual(partial.samples, {});
  assert.match(partial.notes[0], /incomplete/);
});

test("leakSummary: a process present only at the end has no per-process growth; jsHeap-only series works", () => {
  const { samples } = leakSummary([
    { label: "baseline", procs: { jsHeap: 50 } },
    { label: "idle-after", procs: { jsHeap: 58.4, other: 3 } },
  ]);
  assert.deepEqual(samples["memory.leak.growthMB.jsHeap"], [8.4]);
  assert.equal(samples["memory.leak.growthMB.other"], undefined);
});

test("leakTableText lists every checkpoint with a total column", () => {
  const text = leakTableText(leakSummary(series).rows);
  const lines = text.split("\n");
  assert.equal(lines.length, series.length + 1);
  assert.match(lines[0], /checkpoint\s+total\s+app\s+webContent\s+gpu/);
  assert.match(lines[1], /^baseline\s+310\.0\s+100\.0\s+200\.0\s+10\.0$/);
});
