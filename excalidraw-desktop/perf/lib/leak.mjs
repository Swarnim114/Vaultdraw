// Memory leak summary: per-process footprint at the leak scenario's checkpoints -> metric samples.
//
// A checkpoint is { label, procs: { <role>: MB } } with label "baseline", "after-10" ... "after-50", "after-vault-switch",
// "after-vault-return", "idle-after" (the in-app `leak:<label>` marks). Growth is idle-after minus baseline.

export const LEAK_PREFIX = "leak:";
const round = (x) => Math.round(x * 10) / 10;

export const totalMB = (procs) => Object.values(procs).reduce((a, b) => a + b, 0);

/** `after-30` -> 30 (drawings opened so far); baseline -> 0; anything else -> null. */
export function drawingsAt(label) {
  if (label === "baseline") return 0;
  const m = /^after-(\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}

/** Least-squares slope of y over x. NaN with fewer than two distinct x. */
export function slope(points) {
  const n = points.length;
  if (n < 2) return NaN;
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? NaN : num / den;
}

/**
 * Returns { samples, rows, notes }. samples are single-value arrays keyed by metric id:
 *   memory.leak.growthMB                total idle-after - baseline
 *   memory.leak.growthMB.<role>         same, per process (roles present in both checkpoints)
 *   memory.leak.perTenDrawingsMB        slope over baseline + after-N checkpoints, per 10 drawings opened
 *   memory.leak.switchDeltaMB           after-vault-switch minus last after-N (negative: memory given back)
 * rows: [{ label, totalMB, procs }] for display.
 */
export function leakSummary(checkpoints) {
  const rows = checkpoints.map((c) => ({ label: c.label, totalMB: round(totalMB(c.procs)), procs: c.procs }));
  const by = new Map(checkpoints.map((c) => [c.label, c]));
  const samples = {};
  const notes = [];
  const base = by.get("baseline");
  const end = by.get("idle-after");
  if (!base || !end) {
    notes.push(`leak checkpoints incomplete (have: ${checkpoints.map((c) => c.label).join(", ") || "none"}); growth not computed`);
    return { samples, rows, notes };
  }
  samples["memory.leak.growthMB"] = [round(totalMB(end.procs) - totalMB(base.procs))];
  for (const role of Object.keys(end.procs)) {
    if (role in base.procs) samples[`memory.leak.growthMB.${role}`] = [round(end.procs[role] - base.procs[role])];
  }
  const series = checkpoints
    .map((c) => [drawingsAt(c.label), totalMB(c.procs)])
    .filter(([n]) => n !== null);
  const perOne = slope(series);
  if (Number.isFinite(perOne)) samples["memory.leak.perTenDrawingsMB"] = [round(perOne * 10)];
  const lastN = series.at(-1)?.[0] ? by.get(`after-${series.at(-1)[0]}`) : null;
  const sw = by.get("after-vault-switch");
  if (lastN && sw) samples["memory.leak.switchDeltaMB"] = [round(totalMB(sw.procs) - totalMB(lastN.procs))];
  return { samples, rows, notes };
}

/** Compact one-line-per-checkpoint text for result notes. */
export function leakTableText(rows) {
  const roles = [...new Set(rows.flatMap((r) => Object.keys(r.procs)))];
  const head = ["checkpoint", "total", ...roles];
  const lines = rows.map((r) => [r.label, r.totalMB.toFixed(1), ...roles.map((k) => (r.procs[k] === undefined ? "-" : r.procs[k].toFixed(1)))]);
  const w = head.map((_, i) => Math.max(head[i].length, ...lines.map((l) => l[i].length)));
  const fmt = (l) => l.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ");
  return [fmt(head), ...lines.map(fmt)].join("\n");
}
