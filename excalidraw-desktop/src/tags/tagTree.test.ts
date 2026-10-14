import { describe, expect, it } from "vitest";

import { buildTagTree } from "./tagTree";

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
});
