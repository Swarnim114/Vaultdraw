import { describe, expect, it } from "vitest";

import { pickRestoreView } from "./restoreView";

const live = { scrollX: 5, scrollY: 6, zoom: 2 };
const stored = { scrollX: 1, scrollY: 1, zoom: 1 };

describe("pickRestoreView", () => {
  const base = { docId: "d2", path: "a", stored, readLive: () => live };
  it("same path, new doc id: the live view", () => {
    expect(pickRestoreView({ ...base, prev: { id: "d1", path: "a" } })).toBe(
      live,
    );
  });
  it("a different drawing before: the stored view", () => {
    expect(pickRestoreView({ ...base, prev: { id: "d1", path: "b" } })).toBe(
      stored,
    );
  });
  it("no previous editor, or the same document: stored", () => {
    expect(pickRestoreView({ ...base, prev: null })).toBe(stored);
    expect(pickRestoreView({ ...base, prev: { id: "d2", path: "a" } })).toBe(
      stored,
    );
  });
  it("previous editor gone: stored", () => {
    expect(
      pickRestoreView({
        ...base,
        readLive: () => null,
        prev: { id: "d1", path: "a" },
      }),
    ).toBe(stored);
  });
});
