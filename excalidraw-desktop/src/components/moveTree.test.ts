import { describe, expect, it } from "vitest";

import { buildFolderTree, matchingFolderPaths, moveRows } from "./moveTree";

const FOLDERS = [
  "",
  "DSA",
  "DSA/Dynamic Programming",
  "DSA/Graphs",
  "Archive",
  "Deep/Nested/Leaf",
];

const paths = (rows: { entry: { path: string } }[]) =>
  rows.map((r) => r.entry.path);

describe("buildFolderTree", () => {
  it("has the vault root as the single top node, with sorted children", () => {
    const [root] = buildFolderTree(FOLDERS);
    expect(root.entry.path).toBe("");
    expect(root.entry.name).toBe("Vault root");
    expect(root.children!.map((c) => c.entry.path)).toEqual([
      "Archive",
      "Deep",
      "DSA",
    ]);
  });

  it("creates missing ancestors of a leaf", () => {
    const rows = moveRows(FOLDERS, new Set(["", "Deep", "Deep/Nested"]), "");
    expect(paths(rows)).toContain("Deep/Nested/Leaf");
  });
});

describe("moveRows", () => {
  it("shows only the root's children when only the root is open", () => {
    const rows = moveRows(FOLDERS, new Set([""]), "");
    expect(paths(rows)).toEqual(["", "Archive", "Deep", "DSA"]);
    expect(rows.find((r) => r.entry.path === "DSA")).toMatchObject({
      depth: 1,
      expanded: false,
      hasChildren: true,
    });
    expect(rows.find((r) => r.entry.path === "Archive")?.hasChildren).toBe(
      false,
    );
  });

  it("opens folders listed in expanded", () => {
    const rows = moveRows(FOLDERS, new Set(["", "DSA"]), "");
    expect(paths(rows)).toEqual([
      "",
      "Archive",
      "Deep",
      "DSA",
      "DSA/Dynamic Programming",
      "DSA/Graphs",
    ]);
  });

  it("type-ahead keeps matches and their ancestors, all open", () => {
    const rows = moveRows(FOLDERS, new Set([""]), "graph");
    expect(paths(rows)).toEqual(["", "DSA", "DSA/Graphs"]);
  });

  it("matches the folder name, not the whole path, case-insensitively", () => {
    expect(paths(moveRows(FOLDERS, new Set([""]), "dsa"))).toEqual(["", "DSA"]);
    expect(paths(moveRows(FOLDERS, new Set([""]), "  LEAF "))).toEqual([
      "",
      "Deep",
      "Deep/Nested",
      "Deep/Nested/Leaf",
    ]);
  });

  it("leaves only the root when nothing matches", () => {
    expect(paths(moveRows(FOLDERS, new Set([""]), "zzz"))).toEqual([""]);
  });
});

describe("moveRows matches", () => {
  it("flags only the folders that match, not the ancestors kept for context", () => {
    const rows = moveRows(FOLDERS, new Set([""]), "dyn");
    expect(rows.map((r) => [r.entry.path, r.matches])).toEqual([
      ["", false],
      ["DSA", false],
      ["DSA/Dynamic Programming", true],
    ]);
    expect(rows.find((r) => r.matches)?.entry.path).toBe(
      "DSA/Dynamic Programming",
    );
  });

  it("marks every row as a match without a filter", () => {
    expect(moveRows(FOLDERS, new Set([""]), "").every((r) => r.matches)).toBe(
      true,
    );
  });
});

describe("matchingFolderPaths", () => {
  it("is just the root for an empty query", () => {
    expect([...matchingFolderPaths(FOLDERS, "  ")]).toEqual([""]);
  });
});
