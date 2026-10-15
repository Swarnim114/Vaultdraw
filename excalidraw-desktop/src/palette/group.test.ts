import { describe, expect, it } from "vitest";

import { rowHeadings, withCreateRow } from "./group";
import { prepareDrawings, prepareItems, rankRows } from "./rank";

import type { PaletteItem } from "./types";

const drawings = prepareDrawings(["Notes/alpha.excalidraw", "beta.excalidraw"]);
const none = prepareItems([]);
const rank = (q: string) => rankRows(drawings, none, q, []);

describe("withCreateRow", () => {
  it("appends a Create row for a fresh name", () => {
    const rows = withCreateRow(rank("alp"), "alp", "files", true);
    expect(rows.map((r) => r.kind)).toEqual(["drawing", "create"]);
    expect(rows[1]).toMatchObject({ kind: "create", name: "alp" });
  });

  it("skips it for an exact name (any case, folder or extension ignored)", () => {
    expect(withCreateRow(rank("ALPHA"), "ALPHA", "files", true)).toHaveLength(
      1,
    );
    expect(
      withCreateRow(rank("beta.excalidraw"), "beta.excalidraw", "files", true),
    ).toHaveLength(1);
  });

  it("skips it when disabled, empty, commands mode or the name is a path", () => {
    const rows = rank("zzz");
    expect(withCreateRow(rows, "zzz", "files", false)).toBe(rows);
    expect(withCreateRow(rows, "  ", "files", true)).toBe(rows);
    expect(withCreateRow(rows, "zzz", "commands", true)).toBe(rows);
    expect(withCreateRow(rows, "a/b", "files", true)).toBe(rows);
  });
});

describe("rowHeadings", () => {
  it("groups files results: Best match, Other matches, Create", () => {
    const rows = withCreateRow(rank("a"), "a", "files", true);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const heads = rowHeadings(rows, "files", true);
    expect(heads[0]).toBe("Best match");
    expect(heads[1]).toBe("Other matches");
    expect(heads.at(-1)).toBe("Create");
    expect(heads.filter(Boolean)).toHaveLength(3);
  });

  it("has no headings for an empty query or commands mode", () => {
    expect(rowHeadings(rank(""), "files", false).every((h) => !h)).toBe(true);
    const items: PaletteItem[] = [
      { key: "a", title: "Alpha", group: "g", run: () => {} },
    ];
    const rows = rankRows(drawings, prepareItems(items), ">a", []);
    expect(rowHeadings(rows, "commands", true).every((h) => !h)).toBe(true);
  });

  it("is a single pass: one heading slot per row", () => {
    const rows = rank("a");
    expect(rowHeadings(rows, "files", true)).toHaveLength(rows.length);
  });
});
