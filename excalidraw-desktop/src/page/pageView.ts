/**
 * Page mode view lock: the page column is width-fitted and centred, scrolls
 * vertically only, and cannot be zoomed out past half the fit zoom. Pure
 * maths on top of the editor's `appState.scrollConstraints` lock
 * (constrainScrollState): no React, no editor instance.
 */
import {
  getFitPageWidthZoom,
  getPageAreaBounds,
  getPagePitch,
  isPageModeOn,
  pageSetupKey,
} from "@excalidraw/excalidraw/data/pageSetup";
import { constrainScrollState } from "@excalidraw/excalidraw/viewport";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";
import type { AppState, ScrollConstraints } from "@excalidraw/excalidraw/types";

/** Space left and right of the page at fit zoom, viewport px. */
export const PAGE_SIDE_MARGIN = 24;
/**
 * Space above page 1 when scrolled to the top, viewport px: clears the
 * floating toolbar (bottom edge measured at ~64 css px, see the "top inset"
 * e2e screenshot) plus a small gap. A constant, not a DOM read: the toolbar
 * height is fixed by the editor UI and a layout read would couple the view
 * maths to the DOM. Vertical only; the fit-width zoom does not use it.
 */
export const PAGE_TOP_MARGIN = 72;
/** Room below the last page, as a fraction of the viewport height. */
export const PAGE_BOTTOM_FRACTION = 0.4;
/** Minimum zoom = this x the fit-width zoom. */
export const PAGE_MIN_ZOOM_RATIO = 0.5;

export type PageViewState = Pick<
  AppState,
  | "pageSetup"
  | "width"
  | "height"
  | "zoom"
  | "scrollX"
  | "scrollY"
  | "scrollConstraints"
>;

export interface PageViewLock {
  fitZoom: number;
  constraints: ScrollConstraints;
}

/** What the lock was last installed for (per open drawing). */
export interface PageViewMemory {
  key: string;
  fitZoom: number;
}

export type PageViewPatch =
  | Pick<AppState, "scrollConstraints">
  | Pick<AppState, "scrollConstraints" | "scrollX" | "scrollY" | "zoom">;

export const getPageViewKey = (
  setup: PageSetup,
  width: number,
  height: number,
) => `${width}x${height}|${pageSetupKey(setup)}`;

export const getPageViewLock = (
  setup: PageSetup,
  width: number,
  height: number,
): PageViewLock => {
  const fitZoom = getFitPageWidthZoom(setup, width, PAGE_SIDE_MARGIN);
  const [x1, y1, x2, y2] = getPageAreaBounds(setup);
  return {
    fitZoom,
    constraints: {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
      lockScroll: true,
      lockZoom: true,
      zoom: fitZoom * PAGE_MIN_ZOOM_RATIO,
      overscroll: 0,
      offsets: {
        left: PAGE_SIDE_MARGIN,
        right: PAGE_SIDE_MARGIN,
        top: PAGE_TOP_MARGIN,
        bottom: Math.round(height * PAGE_BOTTOM_FRACTION),
      },
    },
  };
};

/** Fit zoom, constraints and the scroll that puts page 1's top in view. */
const openViewport = (lock: PageViewLock, state: PageViewState) =>
  constrainScrollState({
    ...state,
    zoom: { value: lock.fitZoom } as AppState["zoom"],
    scrollX: 0,
    // clamps to the top of the box
    scrollY: Number.MAX_SAFE_INTEGER,
    scrollConstraints: lock.constraints,
  });

/**
 * What to change so the view lock matches the drawing, or null when nothing
 * is needed (the common, cheap case: same key and a lock in place).
 * - page mode off, lock installed by us: clear it;
 * - first time (memory null): fit width, top of page 1;
 * - setup / window size changed or the lock was cleared: re-install keeping
 *   the zoom relative to the fit zoom.
 */
export const reconcilePageView = (
  state: PageViewState,
  memory: PageViewMemory | null,
): { patch: PageViewPatch; memory: PageViewMemory | null } | null => {
  const setup = state.pageSetup;
  if (!isPageModeOn(setup)) {
    return memory ? { patch: { scrollConstraints: null }, memory: null } : null;
  }
  if (state.width <= 0 || state.height <= 0) {
    return null;
  }
  const key = getPageViewKey(setup, state.width, state.height);
  if (memory && memory.key === key && state.scrollConstraints !== null) {
    return null;
  }
  const lock = getPageViewLock(setup, state.width, state.height);
  const nextMemory = { key, fitZoom: lock.fitZoom };
  if (!memory) {
    const view = openViewport(lock, state);
    return {
      patch: { scrollConstraints: lock.constraints, ...view },
      memory: nextMemory,
    };
  }
  const ratio = Math.max(
    PAGE_MIN_ZOOM_RATIO,
    state.zoom.value / memory.fitZoom,
  );
  const view = constrainScrollState({
    ...state,
    zoom: { value: ratio * lock.fitZoom } as AppState["zoom"],
    scrollConstraints: lock.constraints,
  });
  return {
    patch: { scrollConstraints: lock.constraints, ...view },
    memory: nextMemory,
  };
};

/** Scene y of the viewport's top page edge (where page tops are aligned). */
const getViewTopY = (state: Pick<AppState, "scrollY" | "zoom">) =>
  -state.scrollY + PAGE_TOP_MARGIN / state.zoom.value;

/**
 * Scroll that puts the top of the next (or previous) page at the viewport
 * top, or null when there is none. Continuous layout: the next
 * page-height break.
 */
export const getPageStepScroll = (
  state: PageViewState,
  direction: 1 | -1,
): { scrollY: number } | null => {
  const setup = state.pageSetup;
  if (!isPageModeOn(setup)) {
    return null;
  }
  const pitch = getPagePitch(setup);
  const viewTop = getViewTopY(state);
  const epsilon = 1;
  const index =
    direction === 1
      ? Math.floor((viewTop + epsilon) / pitch) + 1
      : Math.ceil((viewTop - epsilon) / pitch) - 1;
  const target = Math.min(setup.pageCount - 1, Math.max(0, index));
  const scrollY = -(target * pitch) + PAGE_TOP_MARGIN / state.zoom.value;
  const next = state.scrollConstraints
    ? constrainScrollState({ ...state, scrollY }).scrollY
    : scrollY;
  return Math.abs(next - state.scrollY) < 1e-6 ? null : { scrollY: next };
};
