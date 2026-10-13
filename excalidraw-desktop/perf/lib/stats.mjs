// Small statistics helpers + per-metric aggregation across runs.

export const NOISY_CV = 0.05;

export function sorted(xs) {
  return [...xs].sort((a, b) => a - b);
}

export function mean(xs) {
  if (!xs.length) return NaN;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** p in [0,100], linear interpolation between closest ranks. */
export function percentile(xs, p) {
  if (!xs.length) return NaN;
  const s = sorted(xs);
  if (s.length === 1) return s[0];
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

export const median = (xs) => percentile(xs, 50);

export function max(xs) {
  return xs.length ? Math.max(...xs) : NaN;
}

/** Sample standard deviation (n-1); 0 for fewer than 2 values. */
export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Coefficient of variation (stdev / mean); 0 when the mean is 0. */
export function cv(xs) {
  const m = mean(xs);
  if (!xs.length || !m) return 0;
  return stdev(xs) / Math.abs(m);
}

const round = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);

/**
 * perRunSamples: Array<Record<metricId, number[]>> (measured runs only).
 * unitOf(id) -> unit string. Returns { [id]: { unit, n, runs, median, p95, max, mean, perRunMedians, cv, noisy } }.
 * median/p95/max are over ALL samples; cv is over the per-run medians.
 */
export function aggregate(perRunSamples, unitOf = () => "") {
  const ids = new Set();
  for (const run of perRunSamples) for (const id of Object.keys(run ?? {})) ids.add(id);
  const out = {};
  for (const id of [...ids].sort()) {
    const all = [];
    const perRunMedians = [];
    for (const run of perRunSamples) {
      const xs = (run?.[id] ?? []).filter((x) => Number.isFinite(x));
      if (!xs.length) continue;
      all.push(...xs);
      perRunMedians.push(median(xs));
    }
    if (!all.length) continue;
    const c = cv(perRunMedians);
    out[id] = {
      unit: unitOf(id),
      n: all.length,
      runs: perRunMedians.length,
      median: round(median(all)),
      p95: round(percentile(all, 95)),
      max: round(max(all)),
      mean: round(mean(all)),
      perRunMedians: perRunMedians.map(round),
      cv: round(c),
      noisy: c > NOISY_CV,
    };
  }
  return out;
}
