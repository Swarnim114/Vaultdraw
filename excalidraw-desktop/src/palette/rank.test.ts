import { describe, expect, it } from "vitest";

import { modeOf, prepareDrawings, prepareItems, rankRows } from "./rank";

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
  it("'>' at the start is commands mode, anything else files mode", () => {
    expect(modeOf("")).toBe("files");
    expect(modeOf("a>b")).toBe("files");
    expect(modeOf(">")).toBe("commands");
    expect(modeOf(">theme")).toBe("commands");
  });

  it("files mode, empty query: recent drawings (MRU), then the rest", () => {
    const rows = rank("", ["drawing:sketch.excalidraw", "gone"]);
    expect(keys(rows)).toEqual([
      "drawing:sketch.excalidraw",
      "drawing:Projects/settings-ui.excalidraw",
      "drawing:a.excalidraw",
    ]);
  });

  it("commands mode, empty query: recent commands (MRU), then the rest", () => {
    const rows = rank(">", ["theme:Nord", "drawing:sketch.excalidraw"]);
    expect(keys(rows)).toEqual([
      "theme:Nord",
      "command:settings.open",
      "command:view.toggleNavigator",
      "theme:Dracula",
    ]);
  });

  it("files mode lists drawings only, commands mode items only", () => {
    expect(keys(rank("sett"))).toEqual([
      "drawing:Projects/settings-ui.excalidraw",
    ]);
    expect(keys(rank("open"))).toEqual([]);
    expect(keys(rank(">sett"))).toEqual(["command:settings.open"]);
  });

  it("boosts recent drawings among equal matches", () => {
    const paths = prepareDrawings(["b/x.excalidraw", "a/x.excalidraw"]);
    const none = prepareItems([]);
    const first = (recent: string[]) =>
      rankRows(paths, none, "x", recent)[0].key;
    expect(first(["drawing:b/x.excalidraw"])).toBe("drawing:b/x.excalidraw");
    expect(first(["drawing:a/x.excalidraw"])).toBe("drawing:a/x.excalidraw");
  });

  it("exact title beats prefix", () => {
    const items = prepareItems([
      item("a", "Theme: Dracula Pro"),
      item("b", "Theme: Dracula"),
    ]);
    const rows = rankRows(prepareDrawings([]), items, ">theme: dracula", []);
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
    const rows = rank(">sidebar");
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
    expect(rank(">", [], 3)).toHaveLength(3);
    expect(rank(">e", [], 2)).toHaveLength(2);
    expect(rank("", [], 2)).toHaveLength(2);
    expect(rank("e", [], 1)).toHaveLength(1);
  });

  it("returns title positions for items", () => {
    const [row] = rank(">dracula");
    expect(row.kind === "item" && row.positions.length).toBe(7);
  });
});
