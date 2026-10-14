import { describe, expect, it } from "vitest";

import { prepareDrawings, prepareItems, rankRows } from "./rank";

import type { PaletteItem } from "./types";

const item = (
  key: string,
  title: string,
  extra: Partial<PaletteItem> = {},
): PaletteItem => ({ key, title, group: "G", run: () => {}, ...extra });

const ITEMS = [
  item("command:settings.open", "Open settings"),
  item("command:view.toggleNavigator", "Toggle navigator", {
    keywords: ["sidebar", "panel"],
  }),
  item("theme:Dracula", "Theme: Dracula"),
  item("theme:Nord", "Theme: Nord"),
];
const PATHS = [
  "Projects/settings-ui.excalidraw",
  "sketch.excalidraw",
  "a.excalidraw",
];

const rank = (query: string, recent: string[] = [], max?: number) =>
  rankRows(prepareDrawings(PATHS), prepareItems(ITEMS), query, recent, max);
const keys = (rows: ReturnType<typeof rank>) => rows.map((r) => r.key);

describe("rankRows", () => {
  it("empty query: recents (MRU), then drawings, then the other items", () => {
    const rows = rank("", ["theme:Nord", "drawing:sketch.excalidraw", "gone"]);
    expect(keys(rows)).toEqual([
      "theme:Nord",
      "drawing:sketch.excalidraw",
      "drawing:Projects/settings-ui.excalidraw",
      "drawing:a.excalidraw",
      "command:settings.open",
      "command:view.toggleNavigator",
      "theme:Dracula",
    ]);
  });

  it("ranks a prefix item title above a fuzzy drawing", () => {
    const rows = rank("open");
    expect(rows[0].key).toBe("command:settings.open");
    expect(keys(rank("sett"))[0]).toBe(
      "drawing:Projects/settings-ui.excalidraw",
    );
  });

  it("exact title beats prefix", () => {
    const items = prepareItems([
      item("a", "Theme: Dracula Pro"),
      item("b", "Theme: Dracula"),
    ]);
    const rows = rankRows(prepareDrawings([]), items, "theme: dracula", []);
    expect(keys(rows)).toEqual(["b", "a"]);
  });

  it("'>' restricts to items and an empty '>' lists them all", () => {
    expect(keys(rank(">settings"))).toEqual(["command:settings.open"]);
    expect(rank(">")).toHaveLength(ITEMS.length);
    expect(rank(">").every((r) => r.kind === "item")).toBe(true);
  });

  it("'>Theme: ' lists the family", () => {
    expect(keys(rank(">Theme: ")).sort()).toEqual([
      "theme:Dracula",
      "theme:Nord",
    ]);
  });

  it("matches keywords without highlighting them", () => {
    const rows = rank("sidebar");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("command:view.toggleNavigator");
    expect(rows[0].positions).toEqual([]);
  });

  it("boosts recents among equal matches", () => {
    // without recents the shorter title wins the tie
    expect(keys(rank(">theme: "))[0]).toBe("theme:Nord");
    expect(keys(rank(">theme: ", ["theme:Dracula"]))[0]).toBe("theme:Dracula");
  });

  it("caps the rows", () => {
    expect(rank("", [], 3)).toHaveLength(3);
    expect(rank("e", [], 2)).toHaveLength(2);
  });

  it("returns title positions for items", () => {
    const [row] = rank(">dracula");
    expect(row.kind === "item" && row.positions.length).toBe(7);
  });
});
