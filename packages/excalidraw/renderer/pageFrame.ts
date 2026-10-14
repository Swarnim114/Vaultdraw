/**
 * Page mode, on-screen frame. The canvas is first filled with the paper
 * colour and the pattern/grid drawn exactly as in normal mode; this module
 * then paints only the complement of the visible pages (the surround), plus
 * the shadows, borders and break lines, which all lie outside the paper.
 * No overdraw, no clip. Exports are not drawn here.
 *
 * Per frame: a handful of thin fillRects. Everything is in device pixels
 * with edges snapped to whole pixels, so page edges stay crisp. No blur.
 */

import {
  getPageIndexRange,
  getPageRect,
  getPagePitch,
} from "../data/pageSetup";

import type { PageSetup } from "../data/pageSetup";
import type { BackgroundPatternView } from "./backgroundPattern";

/** Neutral area around the pages (not run through the display transform). */
export const PAGE_SURROUND_LIGHT = "#e4e4e7";
export const PAGE_SURROUND_DARK = "#1b1b1f";

const BORDER_LIGHT = "rgba(0,0,0,0.18)";
const BORDER_DARK = "rgba(255,255,255,0.14)";
const SHADOW_LIGHT_NEAR = "rgba(0,0,0,0.08)";
const SHADOW_LIGHT_FAR = "rgba(0,0,0,0.04)";
const SHADOW_DARK_NEAR = "rgba(0,0,0,0.35)";
const SHADOW_DARK_FAR = "rgba(0,0,0,0.2)";
const BREAK_LIGHT = "rgba(0,0,0,0.14)";
const BREAK_DARK = "rgba(255,255,255,0.14)";

/** Same fields the notebook pattern needs (device px size, dpr, scroll). */
export type PageFrameView = BackgroundPatternView;

export const getPageSurroundColor = (isDarkMode: boolean) =>
  isDarkMode ? PAGE_SURROUND_DARK : PAGE_SURROUND_LIGHT;

type PageLayout = {
  left: number;
  right: number;
  /** left/right clamped to the canvas */
  L: number;
  R: number;
  first: number;
  last: number;
  separate: boolean;
  dp: number;
  snap: (v: number) => number;
  /** sheet extents (device px): each visible page, or one long sheet */
  tops: number[];
  bottoms: number[];
};

/** Visible page rects in device px (null when no page is in view). */
const getPageLayout = (
  setup: PageSetup,
  view: PageFrameView,
): PageLayout | null => {
  const { scrollX, scrollY, scale, width, height } = view;
  const dp = view.zoom * scale; // device px per scene unit
  const range =
    dp > 0 ? getPageIndexRange(setup, -scrollY, -scrollY + height / dp) : null;
  if (!range) {
    return null;
  }
  const [first, last] = range;
  const separate = setup.layout === "separate";
  const snap = (v: number) => Math.round(v * dp);
  // keep far-off edges (huge zoom) in a sane range; borders then fall off-screen
  const lo = -4;
  const hiX = width + 4;
  const hiY = height + 4;
  const clampTo = (v: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  const left = clampTo(snap(scrollX), hiX);
  const right = clampTo(snap(setup.width + scrollX), hiX);
  const sheets = separate ? last - first + 1 : 1;
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (let i = 0; i < sheets; i++) {
    const top = getPageRect(setup, first + i).y;
    const bottom = separate
      ? top + setup.height
      : getPageRect(setup, last).y + setup.height;
    tops.push(clampTo(snap(top + scrollY), hiY));
    bottoms.push(clampTo(snap(bottom + scrollY), hiY));
  }
  return {
    left,
    right,
    L: Math.max(0, left),
    R: Math.min(width, right),
    first,
    last,
    separate,
    dp,
    snap,
    tops,
    bottoms,
  };
};

const fillRectSafe = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  if (w > 0 && h > 0) {
    context.fillRect(x, y, w, h);
  }
};

/**
 * Paints the surround, shadows, borders and break lines around the visible
 * pages. Call after the pattern/grid and before the elements; the canvas must
 * already hold the paper colour everywhere (bootstrapCanvas).
 */
export const renderPageSurround = (
  context: CanvasRenderingContext2D,
  setup: PageSetup,
  view: PageFrameView,
) => {
  const { scrollY, scale, width, height, isDarkMode } = view;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  const surround = getPageSurroundColor(isDarkMode);
  const fill = (x: number, y: number, w: number, h: number) =>
    fillRectSafe(context, x, y, w, h);

  const layout = getPageLayout(setup, view);
  if (!layout) {
    context.fillStyle = surround;
    context.fillRect(0, 0, width, height);
    context.restore();
    return;
  }
  const { left, right, L, R, first, last, separate, snap, tops, bottoms } =
    layout;
  const sheets = tops.length;
  const hiY = height + 4;
  const border = isDarkMode ? BORDER_DARK : BORDER_LIGHT;

  // 1. surround: side strips (full height) and the gaps inside the column
  context.fillStyle = surround;
  fill(0, 0, L, height);
  fill(R, 0, width - R, height);
  let cursor = 0;
  for (let i = 0; i < sheets; i++) {
    fill(L, cursor, R - L, Math.min(tops[i], height) - cursor);
    cursor = Math.max(cursor, Math.min(bottoms[i], height));
  }
  fill(L, cursor, R - L, height - cursor);

  // 2. shadows (separate): only the L-shaped parts outside the page,
  // far first then near, never over the next page
  if (separate) {
    const d = Math.max(1, Math.round(scale * 2));
    for (const [style, k] of [
      [isDarkMode ? SHADOW_DARK_FAR : SHADOW_LIGHT_FAR, 2 * d],
      [isDarkMode ? SHADOW_DARK_NEAR : SHADOW_LIGHT_NEAR, d],
    ] as const) {
      context.fillStyle = style;
      for (let i = 0; i < sheets; i++) {
        const t = tops[i];
        const b = bottoms[i];
        const end = Math.min(b + k, i + 1 < sheets ? tops[i + 1] : hiY);
        fill(right, t + k, k, end - (t + k));
        fill(left + k, b, right - left - k, end - b);
      }
    }
  }

  // 3. 1 device-px borders around the paper
  context.fillStyle = border;
  for (let i = 0; i < sheets; i++) {
    const t = tops[i];
    const b = bottoms[i];
    fill(left - 1, t - 1, right - left + 2, 1);
    fill(left - 1, b, right - left + 2, 1);
    fill(left - 1, t, 1, b - t);
    fill(right, t, 1, b - t);
  }

  // 4. faint line where the PDF pages split
  if (!separate && last > first) {
    context.fillStyle = isDarkMode ? BREAK_DARK : BREAK_LIGHT;
    const pitch = getPagePitch(setup);
    for (let i = first + 1; i <= last; i++) {
      fill(left, snap(i * pitch + scrollY), right - left, 1);
    }
  }
  context.restore();
};
