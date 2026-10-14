import { describe, expect, it, vi } from "vitest";

import { createLibraryItemsProvider } from "./library";

describe("library items provider", () => {
  it("returns nothing without a source", () => {
    const provider = createLibraryItemsProvider(() => null);
    expect(provider.id).toBe("library-items");
    expect(provider.items()).toEqual([]);
  });

  it("lists 'Insert: <name>' items and run inserts", () => {
    const insert = vi.fn();
    const provider = createLibraryItemsProvider(() => ({
      list: () => [{ id: "7", name: "Arrow set", keywords: ["arrows"] }],
      insert,
    }));
    const [entry] = provider.items();
    expect(entry).toMatchObject({
      key: "library:7",
      title: "Insert: Arrow set",
      group: "Library",
      keywords: ["arrows"],
    });
    void entry.run();
    expect(insert).toHaveBeenCalledWith("7");
  });
});
