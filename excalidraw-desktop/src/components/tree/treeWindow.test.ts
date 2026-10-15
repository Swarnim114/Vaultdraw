import { describe, expect, it } from "vitest";

import { flattenTree, folderDrawingCounts } from "./flattenTree";
import {
  TREE_ROW_HEIGHT,
  WINDOW_MIN_ROWS,
  computeWindow,
} from "./useTreeWindow";

import type { TreeNode } from "../../vault/treeStore";
import type { VaultEntry } from "../../vault/types";

const entry = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt: 0,
  size: 0,
});

describe("flattenTree", () => {
  const tree: TreeNode[] = [
    {
      entry: entry("a", "folder"),
      children: [
        {
          entry: entry("a/b", "folder"),
          children: [{ entry: entry("a/b/c.excalidraw", "drawing") }],
        },
        { entry: entry("a/d.excalidraw", "drawing") },
      ],
    },
    { entry: entry("z.excalidraw", "drawing") },
  ];

  it("lists only children of expanded folders with their depth", () => {
    const rows = flattenTree(tree, new Set(["a"]));
    expect(rows.map((r) => [r.entry.path, r.depth, r.expanded])).toEqual([
      ["a", 0, true],
      ["a/b", 1, false],
      ["a/d.excalidraw", 1, false],
      ["z.excalidraw", 0, false],
    ]);
  });

  it("descends through nested expanded folders and skips unloaded children", () => {
    const rows = flattenTree(tree, new Set(["a", "a/b"]));
    expect(rows.map((r) => r.entry.path)).toContain("a/b/c.excalidraw");
    const unloaded: TreeNode[] = [{ entry: entry("u", "folder") }];
    expect(flattenTree(unloaded, new Set(["u"]))).toHaveLength(1);
  });
});

describe("computeWindow", () => {
  it("renders everything for small lists", () => {
    expect(computeWindow(WINDOW_MIN_ROWS, 0, 600)).toEqual({
      start: 0,
      end: WINDOW_MIN_ROWS,
    });
  });

  it("mounts the viewport plus overscan for a 500 row folder", () => {
    const top = computeWindow(500, 0, 600);
    expect(top.start).toBe(0);
    expect(top.end).toBeLessThan(60);
    const mid = computeWindow(500, 250, 600);
    expect(mid.start).toBeGreaterThan(200);
    expect(mid.end - mid.start).toBeLessThan(60);
    expect(mid.start * TREE_ROW_HEIGHT).toBeLessThanOrEqual(
      250 * TREE_ROW_HEIGHT,
    );
  });

  it("clamps at the end and never inverts", () => {
    expect(computeWindow(500, 490, 600).end).toBe(500);
    const past = computeWindow(500, 900, 600);
    expect(past.start).toBeLessThanOrEqual(past.end);
  });
});

describe("folderDrawingCounts", () => {
  it("counts drawings recursively per ancestor folder", () => {
    const counts = folderDrawingCounts([
      entry("a", "folder"),
      entry("a/b", "folder"),
      entry("a/b/c.excalidraw", "drawing"),
      entry("a/d.excalidraw", "drawing"),
      entry("root.excalidraw", "drawing"),
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("a/b")).toBe(1);
    expect(counts.has("")).toBe(false);
  });

  it("uses the 26 px row height of the design", () => {
    expect(TREE_ROW_HEIGHT).toBe(26);
  });
});
