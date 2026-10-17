// CDP Performance.getMetrics deltas -> load-insensitive metrics (CPU time and event counts).
// Durations come back in seconds; ThreadTime/ProcessTime are CPU time (not wall).
const CPU = {
  TaskDuration: "task",
  ScriptDuration: "script",
  LayoutDuration: "layout",
  RecalcStyleDuration: "recalcStyle",
  V8CompileDuration: "v8Compile",
  ThreadTime: "thread",
  ProcessTime: "process",
};
const COUNT = { LayoutCount: "layout", RecalcStyleCount: "recalcStyle" };

export const toMap = (metrics) => Object.fromEntries((metrics ?? []).map((m) => [m.name, m.value]));

/** end - start for the known metrics; returns { "browser.cpu.<k>": [ms], "browser.count.<k>": [n] }. */
export function cdpDeltas(startMetrics, endMetrics) {
  const a = toMap(startMetrics);
  const b = toMap(endMetrics);
  const out = {};
  const d = (name) => (name in a && name in b ? Math.max(0, b[name] - a[name]) : null);
  for (const [name, key] of Object.entries(CPU)) {
    const v = d(name);
    if (v !== null) out[`browser.cpu.${key}`] = [v * 1000];
  }
  for (const [name, key] of Object.entries(COUNT)) {
    const v = d(name);
    if (v !== null) out[`browser.count.${key}`] = [v];
  }
  return out;
}
