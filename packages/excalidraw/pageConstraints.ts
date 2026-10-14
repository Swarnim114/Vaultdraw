/**
 * Page mode: live blocking of pointer gestures outside the page.
 *
 * Pure functions over `appState.pageSetup` and scene coordinates, called
 * from the pointer handlers in App.tsx. Every function is a no-op (returns
 * its input) when page mode is off.
 *
 * Rules:
 * - A gesture may only start on a page (not in the gap or outside).
 * - Pointer-driven creation, resize and point editing are clamped to the page
 *   where the gesture started (separate layout) or to the whole page column
 *   (continuous layout, where page breaks are only a print concept).
 * - A dragged selection is kept fully inside one page (separate layout: the
 *   page nearest its centre, so it can hop to another page) or inside the
 *   column (continuous).
 */

import {
  clampPointToPage,
  getClampToPageOffset,
  getPageAreaHeight,
  getPageIndexAt,
  getPageIndexContaining,
  isPageModeOn,
} from "./data/pageSetup";

import type { PageSetup } from "./data/pageSetup";

type Point = { x: number; y: number };
type Bounds = readonly [number, number, number, number];

/** False when page mode is on and the scene point is outside every page. */
export const canStartGestureAt = (
  setup: PageSetup | null | undefined,
  x: number,
  y: number,
) => !isPageModeOn(setup) || getPageIndexContaining(setup, x, y) !== -1;

/**
 * The pointer position to use for a creation/resize/point-edit move: `point`
 * clamped to the area the gesture that started at `origin` may use. Returns
 * `point` itself when nothing changes (no allocation).
 */
export const clampGesturePointer = <T extends Point>(
  setup: PageSetup | null | undefined,
  origin: Point,
  point: T,
): T => {
  if (!isPageModeOn(setup)) {
    return point;
  }
  let clamped: Point;
  if (setup.layout === "continuous") {
    clamped = {
      x: Math.min(setup.width, Math.max(0, point.x)),
      y: Math.min(getPageAreaHeight(setup), Math.max(0, point.y)),
    };
  } else {
    const index = getPageIndexContaining(setup, origin.x, origin.y);
    clamped = clampPointToPage(
      setup,
      index === -1 ? getPageIndexAt(setup, origin.y) : index,
      point.x,
      point.y,
    );
  }
  return clamped.x === point.x && clamped.y === point.y
    ? point
    : { ...point, x: clamped.x, y: clamped.y };
};

/**
 * The final drag translation (`offset` is the total translation of the
 * original `bounds`, after snapping) adjusted so the dragged bounds stay
 * fully inside one page / the page column. O(1).
 */
export const constrainDragOffset = (
  setup: PageSetup | null | undefined,
  bounds: Bounds,
  offset: Point,
): Point => {
  if (!isPageModeOn(setup)) {
    return offset;
  }
  const moved: [number, number, number, number] = [
    bounds[0] + offset.x,
    bounds[1] + offset.y,
    bounds[2] + offset.x,
    bounds[3] + offset.y,
  ];
  const { dx, dy } = getClampToPageOffset(setup, moved);
  return dx === 0 && dy === 0 ? offset : { x: offset.x + dx, y: offset.y + dy };
};
