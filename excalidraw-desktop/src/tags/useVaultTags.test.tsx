import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sameTags,
  TAGS_REFRESH_DEBOUNCE_MS,
  useVaultTags,
} from "./useVaultTags";

import type { IndexStatus, VaultSearch } from "../search/types";
import type { TagsResponse } from "./types";

const status: IndexStatus = {
  handle: "h",
  state: "ready",
  indexed: 1,
  total: 1,
};
const response = (display: string): TagsResponse => ({
  tags: [{ tag: display.toLowerCase(), display, count: 1 }],
  byPath: { "a.excalidraw": [display] },
  status,
  tookMs: 0,
});

function setup() {
  let emit: (s: IndexStatus) => void = () => {};
  const tags = vi.fn<(h: string) => Promise<TagsResponse>>();
  const search = {
    tags,
    subscribe: vi.fn(async (l: (s: IndexStatus) => void) => {
      emit = l;
      return () => {};
    }),
  } as unknown as VaultSearch;
  return { search, tags, emit: (s = status) => emit(s) };
}

const flush = () => act(async () => {});

describe("useVaultTags", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns empty data without a search", () => {
    const { result } = renderHook(() => useVaultTags(null, null));
    expect(result.current).toEqual({ tags: [], byPath: {}, loading: false });
  });

  it("fetches on mount", async () => {
    const t = setup();
    t.tags.mockResolvedValue(response("A"));
    const { result } = renderHook(() => useVaultTags(t.search, "h"));
    await flush();
    expect(result.current.tags[0].display).toBe("A");
    expect(result.current.byPath).toEqual({ "a.excalidraw": ["A"] });
    expect(result.current.loading).toBe(false);
  });

  it("debounces status events into one refetch", async () => {
    const t = setup();
    t.tags.mockResolvedValue(response("A"));
    const { result } = renderHook(() => useVaultTags(t.search, "h"));
    await flush();
    t.tags.mockResolvedValue(response("B"));
    act(() => {
      t.emit();
      t.emit();
      t.emit();
    });
    await act(async () => {
      vi.advanceTimersByTime(TAGS_REFRESH_DEBOUNCE_MS - 1);
    });
    expect(t.tags).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(t.tags).toHaveBeenCalledTimes(2);
    expect(result.current.tags[0].display).toBe("B");
  });

  it("drops stale responses and keeps old data on failure", async () => {
    const t = setup();
    t.tags.mockResolvedValueOnce(response("A"));
    const { result } = renderHook(() => useVaultTags(t.search, "h"));
    await flush();

    let resolveSlow: (r: TagsResponse) => void = () => {};
    t.tags.mockReturnValueOnce(new Promise((r) => (resolveSlow = r)));
    t.tags.mockResolvedValueOnce(response("C"));
    act(() => t.emit());
    await act(async () => {
      vi.advanceTimersByTime(TAGS_REFRESH_DEBOUNCE_MS);
    });
    act(() => t.emit());
    await act(async () => {
      vi.advanceTimersByTime(TAGS_REFRESH_DEBOUNCE_MS);
    });
    expect(result.current.tags[0].display).toBe("C");
    await act(async () => resolveSlow(response("STALE")));
    expect(result.current.tags[0].display).toBe("C");

    t.tags.mockRejectedValueOnce(new Error("boom"));
    act(() => t.emit());
    await act(async () => {
      vi.advanceTimersByTime(TAGS_REFRESH_DEBOUNCE_MS);
    });
    expect(result.current.tags[0].display).toBe("C");
    expect(result.current.loading).toBe(false);
  });

  it("ignores events for other vaults", async () => {
    const t = setup();
    t.tags.mockResolvedValue(response("A"));
    renderHook(() => useVaultTags(t.search, "h"));
    await flush();
    act(() => t.emit({ ...status, handle: "other" }));
    await act(async () => {
      vi.advanceTimersByTime(TAGS_REFRESH_DEBOUNCE_MS * 2);
    });
    expect(t.tags).toHaveBeenCalledTimes(1);
  });
});

describe("useVaultTags refetch renders", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the same data object when a refetch answers the same tags", async () => {
    const t = setup();
    t.tags.mockImplementation(async () => response("A"));
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useVaultTags(t.search, "h");
    });
    await flush();
    const before = result.current.byPath;
    const rendersBefore = renders;
    act(() => t.emit());
    await act(async () => {
      vi.advanceTimersByTime(TAGS_REFRESH_DEBOUNCE_MS);
    });
    expect(t.tags).toHaveBeenCalledTimes(2);
    expect(result.current.byPath).toBe(before);
    expect(renders).toBe(rendersBefore);
  });

  it("sameTags compares tags and paths by value", () => {
    const a = response("A");
    expect(sameTags(a, response("A"))).toBe(true);
    expect(sameTags(a, response("B"))).toBe(false);
    expect(
      sameTags(a, {
        ...a,
        byPath: { "a.excalidraw": ["A"], "b.excalidraw": ["A"] },
      }),
    ).toBe(false);
    expect(sameTags(a, { ...a, tags: [{ ...a.tags[0], count: 2 }] })).toBe(
      false,
    );
  });
});

describe("useVaultTags loading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("clears loading when a refetch supersedes the first fetch", async () => {
    const t = setup();
    t.tags.mockReturnValueOnce(new Promise(() => {}));
    t.tags.mockResolvedValueOnce(response("A"));
    const { result } = renderHook(() => useVaultTags(t.search, "h"));
    await flush();
    expect(result.current.loading).toBe(true);
    act(() => t.emit());
    await act(async () => {
      vi.advanceTimersByTime(TAGS_REFRESH_DEBOUNCE_MS);
    });
    expect(result.current.tags[0].display).toBe("A");
    expect(result.current.loading).toBe(false);
  });
});
