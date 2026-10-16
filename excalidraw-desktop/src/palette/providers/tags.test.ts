import { describe, expect, it, vi } from "vitest";

import { createTagsProvider } from "./tags";

describe("tags provider", () => {
  it("lists every tag with its count and applies the filter on run", () => {
    const apply = vi.fn();
    const provider = createTagsProvider({
      tags: () => [
        { tag: "dsa", display: "DSA", count: 7 },
        { tag: "dsa/graphs", display: "DSA/graphs", count: 5 },
      ],
      apply,
    });
    const items = provider.items();
    expect(items.map((i) => [i.key, i.title, i.group])).toEqual([
      ["tag:dsa", "Tag: #DSA (7)", "Tags"],
      ["tag:dsa/graphs", "Tag: #DSA/graphs (5)", "Tags"],
    ]);
    expect(items[1].keywords).toContain("tag:#dsa/graphs");
    void items[1].run();
    expect(apply).toHaveBeenCalledWith("dsa/graphs");
  });

  it("is empty without tags", () => {
    expect(
      createTagsProvider({ tags: () => [], apply: vi.fn() }).items(),
    ).toEqual([]);
  });
});
