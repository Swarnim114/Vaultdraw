/**
 * Tabs (F5): pure, immutable state transitions. No React, no IO, no clock,
 * no randomness (ids come from `state.nextId`). PLAN.md §2, §3.
 *
 * Every function returns the SAME state object when nothing changed, so the
 * store can notify with a cheap `===` check.
 */

import { CLOSED_STACK_CAP } from "./types";

import type {
  ClosedTab,
  OpenOptions,
  OpenTarget,
  Tab,
  TabId,
  TabsState,
  ViewState,
} from "./types";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const homeTab = (id: TabId): Tab => ({
  id,
  path: null,
  pinned: false,
  missing: false,
});

const tabIdFor = (n: number): TabId => `t${n}`;

const pinnedCount = (tabs: readonly Tab[]): number => {
  let n = 0;
  while (n < tabs.length && tabs[n].pinned) {
    n++;
  }
  return n;
};

const indexOfTab = (state: TabsState, id: TabId): number =>
  state.tabs.findIndex((t) => t.id === id);

const insertAt = <T>(list: readonly T[], index: number, item: T): T[] => [
  ...list.slice(0, index),
  item,
  ...list.slice(index),
];

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(n, lo), hi);

/** Strip index for a tab, kept inside its own group (pinned first). */
const clampToGroup = (
  index: number,
  pinned: boolean,
  tabsWithoutIt: readonly Tab[],
): number => {
  const p = pinnedCount(tabsWithoutIt);
  return pinned ? clamp(index, 0, p) : clamp(index, p, tabsWithoutIt.length);
};

const pushClosed = (
  closed: readonly ClosedTab[],
  entries: readonly ClosedTab[],
): readonly ClosedTab[] =>
  entries.length === 0
    ? closed
    : [...closed, ...entries].slice(-CLOSED_STACK_CAP);

/** `p` is `base` itself or lives under the folder `base`. */
const isUnder = (p: string | null, base: string): p is string =>
  p !== null && (p === base || p.startsWith(`${base}/`));

// ---------------------------------------------------------------------------
// Construction and queries
// ---------------------------------------------------------------------------

/** One home tab, active. */
export const initialState = (): TabsState => ({
  tabs: [homeTab("t1")],
  activeId: "t1",
  mru: ["t1"],
  closed: [],
  nextId: 2,
});

/**
 * Build state from a validated session (workspaceStore.deserialize), which
 * already guarantees pinned-first order, unique paths and a full MRU.
 */
export const fromSession = (session: {
  tabs: readonly { path: string | null; pinned: boolean; view?: ViewState }[];
  activeIndex: number;
  mru: readonly number[];
}): TabsState => {
  if (session.tabs.length === 0) {
    return initialState();
  }
  const tabs: Tab[] = session.tabs.map((t, i) => ({
    id: tabIdFor(i + 1),
    path: t.path,
    pinned: t.pinned,
    missing: false,
    ...(t.view ? { view: t.view } : {}),
  }));
  const activeId = tabs[session.activeIndex]?.id ?? tabs[0].id;
  const rest = session.mru.map((i) => tabs[i]?.id).filter(Boolean) as TabId[];
  const mru = [activeId, ...rest.filter((id) => id !== activeId)];
  for (const t of tabs) {
    if (!mru.includes(t.id)) {
      mru.push(t.id);
    }
  }
  return { tabs, activeId, mru, closed: [], nextId: tabs.length + 1 };
};

export const findByPath = (state: TabsState, path: string): Tab | undefined =>
  state.tabs.find((t) => t.path === path);

export const getActiveTab = (state: TabsState): Tab =>
  state.tabs.find((t) => t.id === state.activeId) as Tab;

/** New drawing / template / duplicate rule: reuse a home tab, else a new tab. */
export const targetForCreated = (state: TabsState): OpenTarget =>
  getActiveTab(state).path === null ? "current" : "new";

/**
 * Shortcut close (Cmd+W) honours `tabs.close_pinned`; the caller shows the
 * toast when this is false. `close()` itself always closes.
 */
export const canCloseWithShortcut = (
  state: TabsState,
  id: TabId,
  closePinned: boolean,
): boolean => {
  const tab = state.tabs.find((t) => t.id === id);
  return !!tab && (closePinned || !tab.pinned);
};

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export const activate = (state: TabsState, id: TabId): TabsState => {
  if (state.activeId === id || indexOfTab(state, id) < 0) {
    return state;
  }
  return {
    ...state,
    activeId: id,
    mru: [id, ...state.mru.filter((m) => m !== id)],
  };
};

const activateAt = (state: TabsState, index: number): TabsState =>
  index >= 0 && index < state.tabs.length
    ? activate(state, state.tabs[index].id)
    : state;

/** Next tab in strip order, wrapping. */
export const next = (state: TabsState): TabsState =>
  activateAt(
    state,
    (indexOfTab(state, state.activeId) + 1) % state.tabs.length,
  );

/** Previous tab in strip order, wrapping. */
export const prev = (state: TabsState): TabsState =>
  activateAt(
    state,
    (indexOfTab(state, state.activeId) - 1 + state.tabs.length) %
      state.tabs.length,
  );

/** 1-based; out of range is a no-op. */
export const goTo = (state: TabsState, n: number): TabsState =>
  Number.isInteger(n) ? activateAt(state, n - 1) : state;

export const goToLast = (state: TabsState): TabsState =>
  activateAt(state, state.tabs.length - 1);

/** Ctrl+Tab tap: the most recently used other tab. Twice returns to the start. */
export const mruNext = (state: TabsState): TabsState =>
  state.mru.length > 1 ? activate(state, state.mru[1]) : state;

/** Ctrl+Shift+Tab: the least recently used tab. */
export const mruPrev = (state: TabsState): TabsState =>
  state.mru.length > 1
    ? activate(state, state.mru[state.mru.length - 1])
    : state;

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

const insertNewTab = (
  state: TabsState,
  tab: Tab,
  index: number,
  focus: boolean,
): TabsState => {
  const rest = state.tabs;
  const at = clampToGroup(index, tab.pinned, rest);
  const mru = focus
    ? [tab.id, ...state.mru]
    : [state.mru[0], tab.id, ...state.mru.slice(1)];
  return {
    ...state,
    tabs: insertAt(rest, at, tab),
    activeId: focus ? tab.id : state.activeId,
    mru,
    nextId: state.nextId + 1,
  };
};

const newTabIndex = (
  state: TabsState,
  position: OpenOptions["position"],
): number =>
  position === "end"
    ? state.tabs.length
    : indexOfTab(state, state.activeId) + 1;

/** New home tab, activated. */
export const newTab = (
  state: TabsState,
  position: OpenOptions["position"] = "after_active",
): TabsState =>
  insertNewTab(
    state,
    homeTab(tabIdFor(state.nextId)),
    newTabIndex(state, position),
    true,
  );

/**
 * One tab per file: an already open path just activates its tab. Target
 * "current" replaces the active tab's drawing (clearing view and missing),
 * except a pinned active tab, which is never replaced: a new tab opens right
 * after it. Target "new" inserts at `position`, never before pinned tabs.
 */
export const openPath = (
  state: TabsState,
  path: string,
  options: OpenOptions,
): TabsState => {
  const existing = findByPath(state, path);
  if (existing) {
    return activate(state, existing.id);
  }
  const active = getActiveTab(state);
  if (options.target === "current" && !active.pinned) {
    const tabs = state.tabs.map((t) =>
      t.id === active.id
        ? { id: t.id, path, pinned: false, missing: false }
        : t,
    );
    return { ...state, tabs };
  }
  const position =
    options.target === "current" ? "after_active" : options.position;
  return insertNewTab(
    state,
    { id: tabIdFor(state.nextId), path, pinned: false, missing: false },
    newTabIndex(state, position),
    options.target === "current" || options.focus !== false,
  );
};

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/**
 * Removes `removeIds`. Tabs with a path are recorded on the closed stack when
 * `record` is set (home tabs never are). If the active tab goes, `preferActive`
 * (when it survives) or the MRU previous tab becomes active. Closing every tab
 * leaves one fresh home tab.
 */
const removeTabs = (
  state: TabsState,
  removeIds: ReadonlySet<TabId>,
  record: boolean,
  preferActive?: TabId,
): TabsState => {
  if (removeIds.size === 0) {
    return state;
  }
  const entries: ClosedTab[] = [];
  const survivors: Tab[] = [];
  state.tabs.forEach((tab, index) => {
    if (!removeIds.has(tab.id)) {
      survivors.push(tab);
    } else if (record && tab.path !== null) {
      entries.push({ tab, index });
    }
  });
  const closed = pushClosed(state.closed, entries);
  if (survivors.length === 0) {
    const home = homeTab(tabIdFor(state.nextId));
    return {
      tabs: [home],
      activeId: home.id,
      mru: [home.id],
      closed,
      nextId: state.nextId + 1,
    };
  }
  const mru = state.mru.filter((id) => !removeIds.has(id));
  let activeId = state.activeId;
  if (removeIds.has(activeId)) {
    activeId =
      preferActive !== undefined && !removeIds.has(preferActive)
        ? preferActive
        : mru[0];
  }
  return {
    ...state,
    tabs: survivors,
    activeId,
    mru: [activeId, ...mru.filter((id) => id !== activeId)],
    closed,
  };
};

/** Always closes (context-menu Close); see `canCloseWithShortcut` for Cmd+W. */
export const close = (state: TabsState, id: TabId): TabsState =>
  indexOfTab(state, id) < 0 ? state : removeTabs(state, new Set([id]), true);

/** Pinned tabs are skipped by closeOthers/closeRight/closeAll (Chrome, VS Code). */
export const closeOthers = (state: TabsState, id: TabId): TabsState =>
  indexOfTab(state, id) < 0
    ? state
    : removeTabs(
        state,
        new Set(
          state.tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id),
        ),
        true,
        id,
      );

export const closeRight = (state: TabsState, id: TabId): TabsState => {
  const index = indexOfTab(state, id);
  return index < 0
    ? state
    : removeTabs(
        state,
        new Set(
          state.tabs
            .slice(index + 1)
            .filter((t) => !t.pinned)
            .map((t) => t.id),
        ),
        true,
        id,
      );
};

export const closeAll = (state: TabsState): TabsState =>
  removeTabs(
    state,
    new Set(state.tabs.filter((t) => !t.pinned).map((t) => t.id)),
    true,
  );

/**
 * Reopen the most recently closed tab at its old index (clamped, pinned
 * first), keeping its view. If its file is open again, activate that tab.
 */
export const reopenClosed = (state: TabsState): TabsState => {
  if (state.closed.length === 0) {
    return state;
  }
  const { tab, index } = state.closed[state.closed.length - 1];
  const closed = state.closed.slice(0, -1);
  const existing = tab.path === null ? undefined : findByPath(state, tab.path);
  if (existing) {
    return { ...activate(state, existing.id), closed };
  }
  const reopened = insertNewTab(state, tab, index, true);
  return { ...reopened, nextId: state.nextId, closed };
};

// ---------------------------------------------------------------------------
// Pin and order
// ---------------------------------------------------------------------------

/** Pinned moves to the end of the pinned group; unpinned to the start of the unpinned group. */
export const togglePin = (state: TabsState, id: TabId): TabsState => {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) {
    return state;
  }
  const rest = state.tabs.filter((t) => t.id !== id);
  const toggled = { ...tab, pinned: !tab.pinned };
  return { ...state, tabs: insertAt(rest, pinnedCount(rest), toggled) };
};

/** Move within the tab's own group (pinned or unpinned); out of range clamps. */
export const move = (
  state: TabsState,
  id: TabId,
  toIndex: number,
): TabsState => {
  const from = indexOfTab(state, id);
  if (from < 0 || !Number.isFinite(toIndex)) {
    return state;
  }
  const tab = state.tabs[from];
  const rest = state.tabs.filter((t) => t.id !== id);
  const to = clampToGroup(Math.trunc(toIndex), tab.pinned, rest);
  if (to === from) {
    return state;
  }
  return { ...state, tabs: insertAt(rest, to, tab) };
};

export const moveBy = (
  state: TabsState,
  id: TabId,
  delta: 1 | -1,
): TabsState => {
  const from = indexOfTab(state, id);
  return from < 0 ? state : move(state, id, from + delta);
};

// ---------------------------------------------------------------------------
// Paths changed by the vault (rename, trash, deleted outside)
// ---------------------------------------------------------------------------

const rebase = (p: string | null, from: string, to: string): string | null =>
  p === from
    ? to
    : p !== null && p.startsWith(`${from}/`)
    ? to + p.slice(from.length)
    : p;

/** File or folder rename/move. Folder-safe: "a/b" never matches "a/bc". */
export const renamePath = (
  state: TabsState,
  from: string,
  to: string,
): TabsState => {
  if (from === to) {
    return state;
  }
  const renameTab = (t: Tab): Tab => {
    const path = rebase(t.path, from, to);
    return path === t.path ? t : { ...t, path };
  };
  const tabs = state.tabs.map(renameTab);
  const closed = state.closed.map((c) => {
    const tab = renameTab(c.tab);
    return tab === c.tab ? c : { ...c, tab };
  });
  const tabsSame = tabs.every((t, i) => t === state.tabs[i]);
  const closedSame = closed.every((c, i) => c === state.closed[i]);
  if (tabsSame && closedSame) {
    return state;
  }
  const renamed: TabsState = {
    ...state,
    tabs: tabsSame ? state.tabs : tabs,
    closed: closedSame ? state.closed : closed,
  };
  // Moving onto a path another tab already shows: keep one tab per file.
  const taken = new Set(
    tabs.filter((t, i) => t === state.tabs[i]).map((t) => t.path),
  );
  const duplicates = new Set<TabId>();
  tabs.forEach((t, i) => {
    if (t === state.tabs[i] || t.path === null) {
      return;
    }
    if (taken.has(t.path)) {
      duplicates.add(t.id);
    }
    taken.add(t.path);
  });
  return removeTabs(renamed, duplicates, false);
};

/** In-app trash of a file or folder: closes its tabs without closed-stack entries. */
export const removePath = (state: TabsState, path: string): TabsState => {
  const ids = new Set(
    state.tabs.filter((t) => isUnder(t.path, path)).map((t) => t.id),
  );
  const closed = state.closed.filter((c) => !isUnder(c.tab.path, path));
  const removed = removeTabs(state, ids, false);
  return closed.length === state.closed.length
    ? removed
    : { ...removed, closed };
};

/** Flag tabs of a file (or of every file under a folder) as missing or back. */
export const setMissing = (
  state: TabsState,
  path: string,
  missing: boolean,
): TabsState => {
  if (!state.tabs.some((t) => isUnder(t.path, path) && t.missing !== missing)) {
    return state;
  }
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      isUnder(t.path, path) && t.missing !== missing ? { ...t, missing } : t,
    ),
  };
};

export const setView = (
  state: TabsState,
  id: TabId,
  view: ViewState,
): TabsState => {
  const tab = state.tabs.find((t) => t.id === id);
  const old = tab?.view;
  if (
    !tab ||
    (old &&
      old.scrollX === view.scrollX &&
      old.scrollY === view.scrollY &&
      old.zoom === view.zoom)
  ) {
    return state;
  }
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, view } : t)),
  };
};

// ---------------------------------------------------------------------------
// Invariants (for tests and debug assertions)
// ---------------------------------------------------------------------------

/** Throws on the first broken invariant. */
export const assertInvariants = (state: TabsState): void => {
  const fail = (msg: string): never => {
    throw new Error(`tabs invariant: ${msg}`);
  };
  const ids = state.tabs.map((t) => t.id);
  if (ids.length === 0) {
    fail("tabs empty");
  }
  if (new Set(ids).size !== ids.length) {
    fail("duplicate ids");
  }
  if (!ids.includes(state.activeId)) {
    fail("activeId not in tabs");
  }
  if (
    state.mru.length !== ids.length ||
    new Set(state.mru).size !== ids.length ||
    !state.mru.every((id) => ids.includes(id))
  ) {
    fail("mru is not a permutation of tabs");
  }
  if (state.mru[0] !== state.activeId) {
    fail("mru[0] is not active");
  }
  const p = pinnedCount(state.tabs);
  if (state.tabs.slice(p).some((t) => t.pinned)) {
    fail("pinned tab after unpinned");
  }
  const paths = state.tabs.map((t) => t.path).filter((x) => x !== null);
  if (new Set(paths).size !== paths.length) {
    fail("duplicate path");
  }
  if (state.closed.length > CLOSED_STACK_CAP) {
    fail("closed stack over cap");
  }
};
