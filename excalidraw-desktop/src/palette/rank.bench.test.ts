import { describe, expect, it } from "vitest";

import { prepareDrawings, prepareItems, rankRows } from "./rank";

import type { PaletteItem } from "./types";

const WORDS = [
  "Architecture",
  "Graphs",
  "Dynamic",
  "Programming",
  "Notes",
  "Design",
  "Intro",
  "Roadmap",
  "Café",
  "Sketch",
];
const FOLDERS = [
  "DSA",
  "Work",
  "School",
  "Archive",
  "Projects",
  "Design Notes",
  "2025",
];
/** Deterministic, vault-like paths (same shape as fuzzy.bench.test). */
function generatePaths(count: number): string[] {
  let seed = 42;
  const r = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  return Array.from({ length: count }, (_, i) => {
    const parts = Array.from({ length: Math.floor(r() * 4) }, () =>
      pick(FOLDERS),
    );
    const name = Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
      pick(WORDS),
    );
    return [...parts, `${name.join(" ")} ${i}.excalidraw`].join("/");
  });
}

const typing = (word: string) =>
  Array.from({ length: word.length }, (_, i) => word.slice(0, i + 1));

const QUERIES = [
  ...typing("architecture"),
  ...typing("dp intro"),
  ...typing(">theme: dra"),
  ...typing("zzqxj"),
  ...typing("work des notes"),
  "a",
  "e",
];

const GROUPS = ["File", "View", "Editor", "Theme", "Pen"];
const ITEMS: PaletteItem[] = Array.from({ length: 300 }, (_, i) => ({
  key: `command:c${i}`,
  title:
    i % 3 === 0
      ? `Theme: Sample ${i}`
      : `${GROUPS[i % 5]} ${
          ["Toggle", "Open", "Align", "Insert"][i % 4]
        } thing ${i}`,
  keywords: i % 2 ? ["sidebar", "panel", `kw${i}`] : undefined,
  group: GROUPS[i % 5],
  run: () => {},
}));

describe("palette rank performance (5,000 drawings + 300 items)", () => {
  it("rankRows stays under the per-keystroke budget", () => {
    const t0 = performance.now();
    const drawings = prepareDrawings(generatePaths(5000));
    const items = prepareItems(ITEMS);
    const prepareMs = performance.now() - t0;
    const recent = ["command:c3", "command:c10"];
    for (let i = 0; i < 3; i++) {
      for (const q of QUERIES) {
        rankRows(drawings, items, q, recent);
      }
    }
    const times: number[] = [];
    for (let run = 0; run < 10; run++) {
      for (const q of QUERIES) {
        const s = performance.now();
        rankRows(drawings, items, q, recent);
        times.push(performance.now() - s);
      }
    }
    times.sort((a, b) => a - b);
    const at = (p: number) =>
      times[Math.min(times.length - 1, Math.floor(p * times.length))];
    // eslint-disable-next-line no-console
    console.info(
      `palette rank 5000+300: prepare ${prepareMs.toFixed(1)} ms; rank p50 ${at(
        0.5,
      ).toFixed(2)} ms, p95 ${at(0.95).toFixed(2)} ms, max ${times[
        times.length - 1
      ].toFixed(2)} ms (${times.length} samples)`,
    );
    expect(at(0.95)).toBeLessThan(8);
  });
});
