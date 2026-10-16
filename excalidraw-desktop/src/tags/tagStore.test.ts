import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTagFilter,
  focusTagsPane,
  registerTagActions,
} from "./tagActions";
import { tagStore } from "./tagStore";

afterEach(() => tagStore.set([], {}));

describe("tagStore", () => {
  it("serves the list and per-path tags, notifies on change only", () => {
    const listener = vi.fn();
    const off = tagStore.subscribe(listener);
    const tags = [{ tag: "a", display: "A", count: 2 }];
    const byPath = { "x.excalidraw": ["A"] };
    tagStore.set(tags, byPath);
    expect(tagStore.get()).toBe(tags);
    expect(tagStore.pathTags("x.excalidraw")).toEqual(["A"]);
    expect(tagStore.pathTags("none.excalidraw")).toEqual([]);
    expect(tagStore.pathTags(null)).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    tagStore.set(tags, byPath);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    tagStore.set([], {});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns a stable empty list for an unknown path", () => {
    expect(tagStore.pathTags("a")).toBe(tagStore.pathTags("b"));
  });
});

describe("tagActions", () => {
  it("is a no-op until bound, then forwards, and unbinds", () => {
    expect(() => applyTagFilter("x")).not.toThrow();
    expect(() => focusTagsPane()).not.toThrow();
    const filter = vi.fn();
    const focusPane = vi.fn();
    const off = registerTagActions({ filter, focusPane });
    applyTagFilter("dsa");
    focusTagsPane();
    expect(filter).toHaveBeenCalledWith("dsa");
    expect(focusPane).toHaveBeenCalledTimes(1);
    off();
    applyTagFilter("dsa");
    expect(filter).toHaveBeenCalledTimes(1);
  });

  it("an older unbind does not drop a newer binding", () => {
    const a = { filter: vi.fn(), focusPane: vi.fn() };
    const b = { filter: vi.fn(), focusPane: vi.fn() };
    const offA = registerTagActions(a);
    const offB = registerTagActions(b);
    offA();
    applyTagFilter("k");
    expect(b.filter).toHaveBeenCalledWith("k");
    offB();
  });
});
