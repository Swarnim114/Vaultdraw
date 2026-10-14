import { describe, expect, it } from "vitest";

import { filter, prepare, score } from "./fuzzy";

const rank = (items: string[], q: string, limit = 50) =>
  filter(items, q, prepare, limit).map((r) => r.item);
// filter takes a getter; prepare per call is fine in tests
const prepared = (items: string[]) => items.map((text) => prepare(text));
const rankPrepared = (items: string[], q: string, limit = 50) => {
  const ps = prepared(items);
  return filter(ps, q, (p) => p, limit).map((r) => r.item.text);
};

const highlighted = (text: string, positions: number[]) =>
  positions.map((i) => text[i]).join("");

describe("fuzzy scorer", () => {
  it("ranks the basename word match first", () => {
    const items = [
      "DSA/Dynamic Programming/01 Introduction.excalidraw",
      "Notes/interesting rocks.excalidraw",
      "Intro to Graphs.excalidraw",
      "Random/Internet Router Overview.excalidraw",
    ];
    expect(rankPrepared(items, "intro")[0]).toBe("Intro to Graphs.excalidraw");
    expect(
      rankPrepared(items.slice(0, 1).concat(items.slice(3)), "intro")[0],
    ).toBe("DSA/Dynamic Programming/01 Introduction.excalidraw");
  });

  it("requires every space-separated piece to match", () => {
    const items = [
      "DSA/Dynamic Programming/01 Introduction.excalidraw",
      "DSA/Graphs/01 Introduction.excalidraw",
    ];
    expect(rankPrepared(items, "dp intro")[0]).toBe(items[0]);
    expect(rankPrepared(items, "graphs intro")).toEqual([items[1]]);
    expect(rankPrepared(items, "dp zzz")).toEqual([]);
  });

  it("exact basename beats a longer path containing it", () => {
    const items = [
      "Algorithms/Graphs/01 Intro.excalidraw",
      "Notes about graphs and trees.excalidraw",
      "Graphs.excalidraw",
      "Archive/2020/Graphs.excalidraw",
    ];
    expect(rankPrepared(items, "graphs")[0]).toBe("Graphs.excalidraw");
  });

  it("never matches through the .excalidraw extension", () => {
    const items = [
      "Alpha.excalidraw",
      "Beta.excalidraw",
      "excalidraw notes.excalidraw",
    ];
    expect(rankPrepared(items, "excalidraw")).toEqual([
      "excalidraw notes.excalidraw",
    ]);
    expect(rankPrepared(items, "draw")).toEqual([
      "excalidraw notes.excalidraw",
    ]);
    expect(score("w", prepare("Alpha.excalidraw"))).toBeNull();
  });

  it("matches acronyms at word starts", () => {
    const items = [
      "DSA/Dynamic Programming/01 Introduction.excalidraw",
      "Misc/cardboard supplies.excalidraw",
    ];
    const r = rankPrepared(items, "dpi");
    expect(r[0]).toBe(items[0]);
  });

  it("folds diacritics and case", () => {
    const p = prepare("Menu/Café Plan.excalidraw");
    const r = score("CAFE", p);
    expect(r).not.toBeNull();
    expect(highlighted(p.text, r!.positions)).toBe("Café");
    expect(score("café", p)).not.toBeNull();
  });

  it("returns UTF-16 positions into the original text", () => {
    const text = "DSA/Dynamic Programming/01 Introduction.excalidraw";
    const r = score("intro", prepare(text))!;
    expect(highlighted(text, r.positions)).toBe("Intro");
    expect(r.positions[0]).toBe(text.indexOf("Introduction"));
    const r2 = score("dp intro", prepare(text))!;
    expect(highlighted(text, r2.positions)).toBe("DPIntro");
  });

  it("keeps surrogate pairs whole in positions", () => {
    const text = "Ideas/😀 smile.excalidraw";
    const r = score("😀", prepare(text));
    expect(r).not.toBeNull();
    expect(r!.positions).toEqual([6, 7]);
  });

  it("ranks command titles", () => {
    const titles = [
      "Toggle navigator",
      "New drawing",
      "Open hotkeys",
      "Switch vault",
      "Duplicate drawing",
    ];
    expect(rankPrepared(titles, "new dr")[0]).toBe("New drawing");
    expect(rankPrepared(titles, "nd")[0]).toBe("New drawing");
    expect(rankPrepared(titles, "dd")[0]).toBe("Duplicate drawing");
    expect(rankPrepared(titles, "sv")[0]).toBe("Switch vault");
  });

  it("prefers contiguous over scattered matches", () => {
    const items = ["a b c d e/Notes.excalidraw", "Abcde.excalidraw"];
    expect(rankPrepared(items, "abcde")[0]).toBe("Abcde.excalidraw");
  });

  it("matches camelCase humps", () => {
    const items = ["Misc/foo bar baz.excalidraw", "Misc/FooBarBaz.excalidraw"];
    const r = rankPrepared(items, "fbb");
    expect(r[0]).toBeDefined();
    expect(r).toHaveLength(2);
  });

  it("empty query keeps input order up to the limit; ties are stable and short-first", () => {
    const items = ["b", "a", "c"];
    const e = filter(prepared(items), "  ", (p) => p, 2);
    expect(e.map((r) => r.item.text)).toEqual(["b", "a"]);
    expect(e[0]).toMatchObject({ score: 0, positions: [] });
    expect(rankPrepared(["bz", "az", "a/z", "zz"], "z")).toEqual([
      "a/z",
      "zz",
      "az",
      "bz",
    ]);
    expect(rankPrepared(["b/x", "a/x", "ab/x"], "x")).toEqual([
      "a/x",
      "b/x",
      "ab/x",
    ]);
  });

  it("honours the limit and returns best first", () => {
    const items = Array.from(
      { length: 100 },
      (_, i) => `Folder/Note ${i}.excalidraw`,
    );
    const r = filter(prepared(items), "note", (p) => p, 5);
    expect(r).toHaveLength(5);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    }
  });

  it("returns null / empty when nothing matches", () => {
    expect(score("zq", prepare("Alpha.excalidraw"))).toBeNull();
    expect(rank([], "a")).toEqual([]);
    expect(score("alphabetical", prepare("alpha"))).toBeNull();
  });
});
