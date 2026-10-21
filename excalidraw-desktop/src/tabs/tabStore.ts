/**
 * Tabs (F5): tiny external store for `useSyncExternalStore`. Components
 * subscribe to this store only, so a strip change never re-renders VaultApp.
 */

import { useRef, useSyncExternalStore } from "react";

import { initialState } from "./tabsModel";

import type { Tab, TabsState } from "./types";

export type TabStore = {
  getState: () => TabsState;
  subscribe: (listener: () => void) => () => void;
  /** Apply a pure model transition; listeners run only if the state object changed. */
  update: (fn: (state: TabsState) => TabsState) => void;
};

export const createTabStore = (
  initial: TabsState = initialState(),
): TabStore => {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (fn) => {
      const nextState = fn(state);
      if (nextState === state) {
        return;
      }
      state = nextState;
      listeners.forEach((l) => l());
    },
  };
};

/**
 * Selected value with a stable identity: while `isEqual` says the new result
 * equals the previous one, the previous object is returned (no re-render).
 */
export const useTabsSelector = <T>(
  store: TabStore,
  selector: (state: TabsState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T => {
  const cache = useRef<{
    state: TabsState;
    selector: (state: TabsState) => T;
    value: T;
  } | null>(null);
  const getSnapshot = (): T => {
    const state = store.getState();
    const c = cache.current;
    if (c && c.state === state && c.selector === selector) {
      return c.value;
    }
    const picked = selector(state);
    const value = c && isEqual(c.value, picked) ? c.value : picked;
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
};

/** What the strip draws; `view` is deliberately ignored (read it via getState). */
const sameTabForStrip = (a: Tab, b: Tab): boolean =>
  a === b ||
  (a.id === b.id &&
    a.path === b.path &&
    a.pinned === b.pinned &&
    a.missing === b.missing);

const sameTabList = (a: readonly Tab[], b: readonly Tab[]): boolean =>
  a === b ||
  (a.length === b.length && a.every((t, i) => sameTabForStrip(t, b[i])));

const selectTabs = (s: TabsState): readonly Tab[] => s.tabs;
const selectActive = (s: TabsState): Tab =>
  s.tabs.find((t) => t.id === s.activeId) as Tab;

/** Strip order; not re-rendered by scroll/zoom (`setView`) updates. */
export const useTabList = (store: TabStore): readonly Tab[] =>
  useTabsSelector(store, selectTabs, sameTabList);

/** The active tab; not re-rendered by `setView` updates. */
export const useActiveTab = (store: TabStore): Tab =>
  useTabsSelector(store, selectActive, sameTabForStrip);
