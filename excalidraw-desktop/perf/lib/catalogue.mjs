// Catalogue loading + spec lookup (browser.<id> inherits <id>).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function loadCatalogue(file) {
  const p = file ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "metrics.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Resolved spec for a metric id, or null when unknown. */
export function specFor(catalogue, id) {
  const d = catalogue.defaults ?? {};
  let raw = catalogue.metrics[id];
  if (!raw && id.startsWith("browser.")) raw = catalogue.metrics[id.slice("browser.".length)];
  if (!raw) return null;
  const unit = raw.unit ?? "ms";
  return {
    id,
    unit,
    gate: raw.gate ?? d.gate ?? ["median", "p95"],
    report: raw.report ?? [],
    slack: raw.slack ?? d.slackByUnit?.[unit] ?? 0,
    pct: raw.pct ?? d.pct ?? 5,
    noiseWidening: raw.noiseWidening !== false,
    /** "lower" (default: times, sizes) or "higher" (rates such as fps). */
    better: raw.better === "higher" ? "higher" : "lower",
    budgets: raw.budgets ?? [],
    desc: raw.desc ?? "",
  };
}

export const unitOf = (catalogue) => (id) => specFor(catalogue, id)?.unit ?? "";

/** Catalogue order index for stable sorting (unknown ids last). */
export function orderIndex(catalogue, id) {
  const keys = Object.keys(catalogue.metrics);
  const base = id.startsWith("browser.") && !catalogue.metrics[id] ? id.slice(8) : id;
  const i = keys.indexOf(base);
  return (i < 0 ? 999 : i) + (id.startsWith("browser.") ? 1000 : 0);
}
