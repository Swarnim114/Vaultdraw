// Memory leak summary: per-process footprint at the leak scenario's checkpoints -> metric samples.
//
// A checkpoint is { label, procs: { <role>: MB } } (the in-app `leak:<label>` marks): "baseline", "p1-after-10" ... "p1-after-50",
// "p2-after-10" ... "p2-after-50" (second pass over the same drawings), "after-vault-switch", "after-vault-return", "idle-after".
// Growth is idle-after minus baseline.

export const LEAK_PREFIX = "leak:";
const round = (x) => Math.round(x * 10) / 10;

export const totalMB = (procs) => Object.values(procs).reduce((a, b) => a + b, 0);

/** `p2-after-30` -> { pass: 2, n: 30 }; `after-30` is pass 1; baseline -> { pass: 0, n: 0 }; anything else -> null. */
export function parseCheckpoint(label) {
  if (label === "baseline") return { pass: 0, n: 0 };
  const m = /^(?:p(\d+)-)?after-(\d+)$/.exec(label);
  return m ? { pass: m[1] ? Number(m[1]) : 1, n: Number(m[2]) } : null;
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
 *   memory.leak.perTenDrawingsMB        pass 1 slope (baseline + after-N), per 10 drawings opened
 *   memory.leak.pass2PerTenDrawingsMB   pass 2 slope (from the end of pass 1); ~0 = plateau
 *   memory.leak.pass2GrowthMB           end of pass 2 minus end of pass 1; ~0 = plateau
 *   memory.leak.switchDeltaMB           after-vault-switch minus end of the last pass (negative: memory given back)
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
  // Per-pass series of (drawings opened in the pass, total MB); each pass starts from the previous pass's end.
  const parsed = checkpoints.map((c) => ({ c, p: parseCheckpoint(c.label) })).filter((x) => x.p);
  const passes = [...new Set(parsed.map((x) => x.p.pass))].filter((k) => k > 0).sort((x, y) => x - y);
  const lastOf = (pass) => parsed.filter((x) => x.p.pass === pass).at(-1)?.c;
  const perTen = {};
  for (const pass of passes) {
    const start = pass === 1 ? base : lastOf(pass - 1);
    if (!start) continue;
    const pts = [[0, totalMB(start.procs)], ...parsed.filter((x) => x.p.pass === pass).map((x) => [x.p.n, totalMB(x.c.procs)])];
    const k = slope(pts);
    if (Number.isFinite(k)) perTen[pass] = round(k * 10);
  }
  if (perTen[1] !== undefined) samples["memory.leak.perTenDrawingsMB"] = [perTen[1]];
  if (perTen[2] !== undefined) samples["memory.leak.pass2PerTenDrawingsMB"] = [perTen[2]];
  const end1 = passes.includes(1) ? lastOf(1) : null;
  const end2 = passes.includes(2) ? lastOf(2) : null;
  if (end1 && end2) samples["memory.leak.pass2GrowthMB"] = [round(totalMB(end2.procs) - totalMB(end1.procs))];
  const lastPass = passes.length ? lastOf(passes.at(-1)) : null;
  const sw = by.get("after-vault-switch");
  if (lastPass && sw) samples["memory.leak.switchDeltaMB"] = [round(totalMB(sw.procs) - totalMB(lastPass.procs))];
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
