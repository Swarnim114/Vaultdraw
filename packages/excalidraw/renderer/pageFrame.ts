/**
 * Page mode, on-screen frame: the neutral surround, the visible pages
 * (shadow, border, paper) and the clip that keeps the notebook pattern on
 * the paper. Exports are not drawn here (they clip to page rects elsewhere).
 *
 * Per frame: a few fillRects per visible page and one clip. Everything is
 * drawn in device pixels with edges snapped to whole pixels, so page edges
 * stay crisp while panning and zooming. No blur, no per-frame strings.
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

export type PageFrameColors = {
  /** on-screen paper colour: applyCanvasBackgroundFilter(viewBackgroundColor) */
  paper: string;
};

/** Visible page rects in device px, flat [left, top, right, bottom, ...]. */
export type PageClip = number[];

export const getPageSurroundColor = (isDarkMode: boolean) =>
  isDarkMode ? PAGE_SURROUND_DARK : PAGE_SURROUND_LIGHT;

/**
 * Draws the surround and the visible pages. Returns the clip for the pattern
 * (empty when no page is in view: clips everything; the surround is still drawn).
 */
export const renderPageFrame = (
  context: CanvasRenderingContext2D,
  setup: PageSetup,
  view: PageFrameView,
  colors: PageFrameColors,
): PageClip => {
  const { scrollX, scrollY, scale, width, height, isDarkMode } = view;
  const dp = view.zoom * scale; // device px per scene unit
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = getPageSurroundColor(isDarkMode);
  context.fillRect(0, 0, width, height);

  const range =
    dp > 0 ? getPageIndexRange(setup, -scrollY, -scrollY + height / dp) : null;
  if (!range) {
    context.restore();
    return [];
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
  const clip: PageClip = [];
  const border = isDarkMode ? BORDER_DARK : BORDER_LIGHT;

  // the sheets to draw: each visible page, or one long sheet when continuous
  const sheets = separate ? last - first + 1 : 1;
  for (let i = 0; i < sheets; i++) {
    const top = getPageRect(setup, first + i).y;
    const bottom = separate
      ? top + setup.height
      : getPageRect(setup, last).y + setup.height;
    const t = clampTo(snap(top + scrollY), hiY);
    const b = clampTo(snap(bottom + scrollY), hiY);
    if (separate) {
      const d = Math.max(1, Math.round(scale * 2));
      context.fillStyle = isDarkMode ? SHADOW_DARK_FAR : SHADOW_LIGHT_FAR;
      context.fillRect(left + 2 * d, t + 2 * d, right - left, b - t);
      context.fillStyle = isDarkMode ? SHADOW_DARK_NEAR : SHADOW_LIGHT_NEAR;
      context.fillRect(left + d, t + d, right - left, b - t);
    }
    // 1 device-px border around the paper
    context.fillStyle = border;
    context.fillRect(left - 1, t - 1, right - left + 2, b - t + 2);
    context.fillStyle = colors.paper;
    context.fillRect(left, t, right - left, b - t);
    clip.push(left, t, right, b);
  }

  if (!separate && last > first) {
    // faint line where the PDF pages split
    context.fillStyle = isDarkMode ? BREAK_DARK : BREAK_LIGHT;
    const pitch = getPagePitch(setup);
    for (let i = first + 1; i <= last; i++) {
      context.fillRect(left, snap(i * pitch + scrollY), right - left, 1);
    }
  }
  context.restore();
  return clip;
};

/** Runs `draw` clipped to the page rects (no clip when `clip` is null). */
export const withPageClip = (
  context: CanvasRenderingContext2D,
  clip: PageClip | null,
  draw: () => void,
) => {
  if (!clip) {
    draw();
    return;
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.beginPath();
  for (let i = 0; i < clip.length; i += 4) {
    context.rect(
      clip[i],
      clip[i + 1],
      clip[i + 2] - clip[i],
      clip[i + 3] - clip[i + 1],
    );
  }
  context.clip();
  draw();
  context.restore();
};
