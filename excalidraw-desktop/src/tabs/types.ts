/**
 * Tabs (F5): shared types. One live editor; every other tab is data.
 * See personal/feature/tabs/PLAN.md §2. No React, no IO here.
 */

export type TabId = string;

/** Scroll and zoom of a tab's canvas (about 24 bytes; never evicted). */
export type ViewState = { scrollX: number; scrollY: number; zoom: number };

export type Tab = {
  id: TabId;
  /** Vault-relative drawing path; `null` = home tab (no editor mounted). */
  path: string | null;
  pinned: boolean;
  /** The file was deleted or renamed outside the app (struck-through name). */
  missing: boolean;
  view?: ViewState;
};

/** A closed tab and the strip index it had, for "Reopen closed tab". */
export type ClosedTab = { tab: Tab; index: number };

export type TabsState = {
  /** Strip order. Pinned tabs always come before unpinned ones. Never empty. */
  tabs: readonly Tab[];
  activeId: TabId;
  /** Open tab ids, most recently active first (always a permutation of `tabs`). */
  mru: readonly TabId[];
  /** Closed-tab stack, most recent last, capped at CLOSED_STACK_CAP. */
  closed: readonly ClosedTab[];
  /** Counter for new tab ids (ids are `t${n}`), keeps the reducer pure. */
  nextId: number;
};

export const CLOSED_STACK_CAP = 20;

/** Where an "open drawing" request goes (PLAN.md §3 opening rules). */
export type OpenTarget = "current" | "new";

export type NewTabPosition = "after_active" | "end";

export type OpenOptions = {
  target: OpenTarget;
  /** For target "new": activate the new tab (`tabs.focus_new`, default true). */
  focus?: boolean;
  position?: NewTabPosition;
};

/** Session saved per vault, outside the vault (PLAN.md §3 session restore). */
export type WorkspaceSessionV1 = {
  v: 1;
  tabs: { path: string | null; pinned: boolean; view?: ViewState }[];
  /** Index into `tabs`. */
  active: number;
  /** Indexes into `tabs`, most recent first. */
  mru: number[];
};
