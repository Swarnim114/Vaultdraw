import { describe, expect, it } from "vitest";

import { prepareDrawings, prepareItems, rankRows } from "../../palette/rank";

import { SuggestRanker } from "./suggestRank";

const WORDS = ["Architecture", "Graphs", "Dynamic", "Programming", "Notes"];
const FOLDERS = ["DSA", "Work", "Design Notes", "2025"];

function generatePaths(count: number): string[] {
  let seed = 7;
  const r = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  return Array.from({ length: count }, (_, i) => {
    const parts = Array.from({ length: Math.floor(r() * 3) }, () =>
      pick(FOLDERS),
    );
    const name = Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
      pick(WORDS),
    );
    return [...parts, `${name.join(" ")} ${i}.excalidraw`].join("/");
  });
}

describe("SuggestRanker wide-query shortlist", () => {
  it("returns the same rows as a full palette rank", () => {
    const names = generatePaths(8000);
    const full = prepareDrawings(names);
    const ranker = new SuggestRanker();
    for (const q of [
      "a",
      "ar",
      "architecture",
      "notes",
      "notes arch",
      "arch notes",
      "dyn prog",
      "design",
      "work",
      "g",
    ]) {
      ranker.reset();
      const got = ranker.rank(names, q, [], 8).map((r) => r.key);
      const want = rankRows(full, prepareItems([]), q, [], 8).map((r) => r.key);
      expect(got, q).toEqual(want);
    }
  });
});
