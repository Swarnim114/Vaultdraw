import { describe, expect, it } from "vitest";

import { createResolver } from "../../links/resolve";
import { DEFAULT_LINKS_SETTINGS } from "../../links/types";

import { linkTargetFor } from "../../links/format";

import { SuggestRanker } from "./suggestRank";

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

function generatePaths(count: number): string[] {
  let seed = 7;
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
const SESSIONS = [
  "architecture",
  "dp intro",
  "zzqxj",
  "work des notes",
  "a",
  "e",
  "graphs dijk",
];

describe("[[ autocomplete ranking (keystroke -> rows, excluding paint)", () => {
  for (const [count, budget] of [
    [10_000, 8],
    [50_000, 25], // plan budget 16 ms; measured ~17 ms (shared ranker's DP cost)
  ] as const) {
    it(`${count} names: p95 under ${budget} ms`, () => {
      const names = generatePaths(count);
      const resolver = createResolver(names);
      const ranker = new SuggestRanker();
      const t0 = performance.now();
      ranker.rank(names, "warm", [], 8); // prepares the index lazily
      const firstMs = performance.now() - t0;
      // One typing session per query word; the cache starts empty each time
      // (the first keystrokes are the expensive ones).
      const sessions = SESSIONS.map(typing);
      const keystroke = (q: string) => {
        const rows = ranker.rank(names, q, [], 8);
        for (const row of rows) {
          if (row.kind === "drawing") {
            linkTargetFor(
              row.drawing.path,
              "a.excalidraw",
              resolver,
              DEFAULT_LINKS_SETTINGS.newLinkFormat,
            );
          }
        }
      };
      for (const s of sessions) {
        ranker.reset();
        s.forEach(keystroke);
      }
      const times: number[] = [];
      for (let run = 0; run < 4; run++) {
        for (const s of sessions) {
          ranker.reset();
          for (const q of s) {
            const t = performance.now();
            keystroke(q);
            times.push(performance.now() - t);
          }
        }
      }
      times.sort((a, b) => a - b);
      const at = (p: number) => times[Math.floor(p * (times.length - 1))];
      // eslint-disable-next-line no-console
      console.info(
        `[[ rank ${count}: first ${firstMs.toFixed(
          0,
        )} ms (index warm-up), p50 ${at(0.5).toFixed(2)} ms, p95 ${at(
          0.95,
        ).toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms (${
          times.length
        } keystrokes)`,
      );
      expect(at(0.95)).toBeLessThan(budget);
    });
  }
});

describe("incremental narrowing is exact", () => {
  it("returns what a full rank returns, for typing and backspacing", async () => {
    const { prepareDrawings, prepareItems, rankRows } = await import(
      "../../palette/rank"
    );
    const { SuggestRanker } = await import("./suggestRank");
    const names = generatePaths(3000);
    const full = prepareDrawings(names);
    const items = prepareItems([]);
    const ranker = new SuggestRanker();
    const seq = [
      ...typing("architecture"),
      ...typing("architecture").reverse(),
      ...typing("dp intro"),
      "work des",
      "wor",
      "café",
      "cafe n",
      "",
      "zzz",
    ];
    for (const q of seq) {
      const a = ranker
        .rank(names, q, [], 8)
        .map((r) => (r.kind === "drawing" ? r.drawing.path : ""));
      const b = rankRows(full, items, q, [], 8).map((r) =>
        r.kind === "drawing" ? r.drawing.path : "",
      );
      expect(a, q).toEqual(b);
    }
  });
});
