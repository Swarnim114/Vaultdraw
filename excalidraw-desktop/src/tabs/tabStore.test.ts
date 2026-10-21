import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createTabStore,
  useActiveTab,
  useTabList,
  useTabsSelector,
} from "./tabStore";
import { activate, newTab, openPath, setView } from "./tabsModel";

describe("createTabStore", () => {
  it("starts with one home tab", () => {
    const store = createTabStore();
    expect(store.getState().tabs).toHaveLength(1);
  });

  it("notifies only when the state object changed", () => {
    const store = createTabStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.update((s) => s);
    expect(listener).not.toHaveBeenCalled();
    store.update((s) => openPath(s, "a", { target: "current" }));
    expect(listener).toHaveBeenCalledTimes(1);
    store.update((s) => openPath(s, "a", { target: "current" })); // already active
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.update(newTab);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("hooks", () => {
  it("useTabList re-renders on strip changes but not on setView", () => {
    const store = createTabStore();
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useTabList(store);
    });
    const first = result.current;
    expect(first).toHaveLength(1);
    const before = renders;
    act(() =>
      store.update((s) =>
        setView(s, s.activeId, { scrollX: 1, scrollY: 1, zoom: 2 }),
      ),
    );
    expect(renders).toBe(before);
    expect(result.current).toBe(first);
    act(() => store.update((s) => openPath(s, "a", { target: "new" })));
    expect(result.current).toHaveLength(2);
  });

  it("useActiveTab follows activation", () => {
    const store = createTabStore();
    act(() => store.update((s) => openPath(s, "a", { target: "new" })));
    const { result } = renderHook(() => useActiveTab(store));
    expect(result.current.path).toBe("a");
    act(() => store.update((s) => activate(s, s.tabs[0].id)));
    expect(result.current.path).toBeNull();
  });

  it("useTabsSelector keeps a stable result while isEqual holds", () => {
    const store = createTabStore();
    const { result } = renderHook(() =>
      useTabsSelector(
        store,
        (s) => ({ n: s.tabs.length }),
        (a, b) => a.n === b.n,
      ),
    );
    const first = result.current;
    act(() =>
      store.update((s) =>
        setView(s, s.activeId, { scrollX: 1, scrollY: 1, zoom: 1 }),
      ),
    );
    expect(result.current).toBe(first);
    act(() => store.update(newTab));
    expect(result.current.n).toBe(2);
  });
});
