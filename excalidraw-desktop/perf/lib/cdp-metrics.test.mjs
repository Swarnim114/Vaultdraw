import test from "node:test";
import assert from "node:assert/strict";
import { cdpDeltas } from "./cdp-metrics.mjs";

test("cdpDeltas converts seconds to ms and diffs counts", () => {
  const m = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
  const out = cdpDeltas(
    m({ TaskDuration: 1, ScriptDuration: 0.5, LayoutCount: 10, JSHeapUsedSize: 5 }),
    m({ TaskDuration: 1.25, ScriptDuration: 0.75, LayoutCount: 14, JSHeapUsedSize: 9, ThreadTime: 3 }),
  );
  assert.deepEqual(out, { "browser.cpu.task": [250], "browser.cpu.script": [250], "browser.count.layout": [4] });
});
