import { describe, expect, it } from "vitest";

import { buildTagTree, flattenTree } from "./tagTree";

describe("buildTagTree", () => {
  it("nests by slash and sorts siblings by label", () => {
    const tree = buildTagTree([
      { tag: "dsa", display: "DSA", count: 3 },
      { tag: "dsa/graphs", display: "DSA/Graphs", count: 2 },
      { tag: "dsa/arrays", display: "DSA/arrays", count: 1 },
      { tag: "todo", display: "todo", count: 1 },
    ]);
    expect(tree.map((n) => n.label)).toEqual(["DSA", "todo"]);
    expect(tree[0].children.map((n) => [n.label, n.display, n.count])).toEqual([
      ["arrays", "DSA/arrays", 1],
      ["Graphs", "DSA/Graphs", 2],
    ]);
  });

  it("synthesises a missing parent from its children", () => {
    const [root] = buildTagTree([
      { tag: "a/b/c", display: "A/B/C", count: 2 },
      { tag: "a/b/d", display: "A/B/D", count: 4 },
    ]);
    expect(root).toMatchObject({ key: "a", label: "A", count: 4 });
    expect(root.children[0]).toMatchObject({ key: "a/b", display: "A/B" });
    expect(root.children[0].children).toHaveLength(2);
  });

  it("is empty for no tags", () => {
    expect(buildTagTree([])).toEqual([]);
  });

  it("sorts by count at every level, name breaking ties", () => {
    const tree = buildTagTree(
      [
        { tag: "a", display: "a", count: 1 },
        { tag: "b", display: "b", count: 5 },
        { tag: "b/x", display: "b/x", count: 1 },
        { tag: "b/y", display: "b/y", count: 4 },
        { tag: "c", display: "c", count: 5 },
      ],
      "count",
    );
    expect(tree.map((n) => n.key)).toEqual(["b", "c", "a"]);
    expect(tree[0].children.map((n) => n.key)).toEqual(["b/y", "b/x"]);
  });

  it("sorts a synthesised parent by its derived count", () => {
    const tree = buildTagTree(
      [
        { tag: "p/q", display: "p/q", count: 7 },
        { tag: "z", display: "z", count: 3 },
      ],
      "count",
    );
    expect(tree.map((n) => n.key)).toEqual(["p", "z"]);
  });
});

describe("flattenTree", () => {
  const tree = buildTagTree([
    { tag: "a", display: "a", count: 2 },
    { tag: "a/b", display: "a/b", count: 1 },
    { tag: "c", display: "c", count: 1 },
  ]);

  it("lists open nodes depth-first with parents", () => {
    const rows = flattenTree(tree, new Set());
    expect(rows.map((r) => [r.node.key, r.depth, r.parent, r.isOpen])).toEqual([
      ["a", 0, null, true],
      ["a/b", 1, "a", false],
      ["c", 0, null, false],
    ]);
  });

  it("hides the descendants of collapsed nodes", () => {
    const rows = flattenTree(tree, new Set(["a"]));
    expect(rows.map((r) => r.node.key)).toEqual(["a", "c"]);
    expect(rows[0].isOpen).toBe(false);
  });
});
