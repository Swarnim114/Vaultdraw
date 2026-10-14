/**
 * Canvas renderer for notebook backgrounds (see data/backgroundPattern.ts).
 *
 * Draws in device pixels with an identity transform so lines land on whole
 * pixels and dots stay locked to scene coordinates: scene -> device is
 * `(x + scroll) * zoom * scale`. Steady-state frames allocate nothing.
 *
 * Zoom gestures redraw every frame at a new, fractional gap, so the per-frame
 * work stays proportional to rows + columns, never to rows x columns:
 * - lines: one fillRect per visible line (axis-aligned and pixel-snapped, so
 *   identical to a stroke, and rect fills are the fast path everywhere);
 * - dots/isometric: one row of dots is drawn into a few small strip canvases
 *   (exact x, one per sub-pixel y phase; cached while the columns don't move)
 *   and copied once per row at a whole-pixel y (no resampling).
 */

import {
  applyDarkModeFilter,
  getDisplayColorTransformVersion,
} from "@excalidraw/common";

import {
  PATTERN_MARGIN_X,
  getIsometricRowHeight,
  getPatternColors,
  getPatternDotRadiusPx,
  hasMajorLines,
  patternLevelAlpha,
} from "../data/backgroundPattern";

import type { BackgroundPattern } from "../data/backgroundPattern";

export type BackgroundPatternView = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** device pixel ratio (CSS px -> device px) */
  scale: number;
  /** device px */
  width: number;
  /** device px */
  height: number;
  isDarkMode: boolean;
};

/** Levels with more lines than this in one frame are skipped. */
export const MAX_PATTERN_LINES = 2000;
/** The dot path (no canvas available for strips) draws at most this many dots. */
export const MAX_PATTERN_FALLBACK_DOTS = 20000;
/** Dot rows land on 1 / DOT_ROW_PHASES device px (strip path). */
export const DOT_ROW_PHASES = 2;

// ---------------------------------------------------------------------------
// colours: memoised per (colour, dark, display transform version)
// ---------------------------------------------------------------------------

const colorCache = {
  version: -1,
  maps: [new Map<string, string>(), new Map<string, string>()],
};

const resolveColor = (color: string, isDarkMode: boolean) => {
  const version = getDisplayColorTransformVersion();
  if (version !== colorCache.version) {
    colorCache.version = version;
    colorCache.maps[0].clear();
    colorCache.maps[1].clear();
  }
  const map = colorCache.maps[isDarkMode ? 1 : 0];
  let resolved = map.get(color);
  if (resolved === undefined) {
    resolved = applyDarkModeFilter(color, isDarkMode);
    map.set(color, resolved);
  }
  return resolved;
};

const mod = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

// ---------------------------------------------------------------------------
// lines (grid, graph, ruled)
// ---------------------------------------------------------------------------

/**
 * Every visible line of a level (scene positions k * step, k in
 * [first, last]), skipping multiples of `skipEvery` (0 = none), as one
 * device-pixel-aligned fillRect each. `origin` is the scroll on the line's
 * axis. Skips the level when it is over the line cap.
 */
const fillLevel = (
  context: CanvasRenderingContext2D,
  vertical: boolean,
  origin: number,
  step: number,
  skipEvery: number,
  zoomScale: number,
  lineWidth: number,
  extent: number,
  length: number,
) => {
  const first = Math.ceil(-origin / step);
  const last = Math.floor((extent / zoomScale - origin) / step);
  if (last - first + 1 > MAX_PATTERN_LINES) {
    return;
  }
  // Vaultdraw: also the line just past each edge when its whole-pixel rect
  // still reaches into the canvas (centred just outside, it covers the
  // first/last device pixel; a tile's edge must match the full canvas there)
  for (let k = first - 1; k <= last + 1; k++) {
    if (skipEvery && k % skipEvery === 0) {
      continue;
    }
    const position = (k * step + origin) * zoomScale;
    if (k < first || k > last) {
      const start = Math.round(position - lineWidth / 2);
      if (start + lineWidth <= 0 || start >= extent) {
        continue;
      }
    }
    fillLine(context, vertical, position, lineWidth, length);
  }
};

/**
 * A line of `lineWidth` device px centred on the device-pixel-snapped
 * `position`: whole pixels, so the same pixels a butt-capped stroke covers.
 */
const fillLine = (
  context: CanvasRenderingContext2D,
  vertical: boolean,
  position: number,
  lineWidth: number,
  length: number,
) => {
  const start = Math.round(position - lineWidth / 2);
  if (vertical) {
    context.fillRect(start, 0, lineWidth, length);
  } else {
    context.fillRect(0, start, length, lineWidth);
  }
};

const drawLevel = (
  context: CanvasRenderingContext2D,
  vertical: boolean,
  view: BackgroundPatternView,
  step: number,
  skipEvery: number,
  color: string,
  alpha: number,
  lineWidth: number,
) => {
  if (alpha <= 0) {
    return;
  }
  const zoomScale = view.zoom * view.scale;
  context.globalAlpha = alpha;
  context.fillStyle = color;
  fillLevel(
    context,
    vertical,
    vertical ? view.scrollX : view.scrollY,
    step,
    skipEvery,
    zoomScale,
    lineWidth,
    vertical ? view.width : view.height,
    vertical ? view.height : view.width,
  );
};

const renderLines = (
  context: CanvasRenderingContext2D,
  pattern: BackgroundPattern,
  view: BackgroundPatternView,
) => {
  const colors = getPatternColors(pattern);
  const lineWidth = Math.max(1, Math.round(view.scale));
  const minorStep = pattern.spacing;
  const gapPx = minorStep * view.zoom;
  const minorAlpha = colors.minorAlpha * patternLevelAlpha(gapPx);
  const minorColor = resolveColor(colors.minor, view.isDarkMode);

  if (pattern.type === "lines") {
    drawLevel(
      context,
      false,
      view,
      minorStep,
      0,
      minorColor,
      minorAlpha,
      lineWidth,
    );
    if (pattern.marginLine) {
      const zoomScale = view.zoom * view.scale;
      const x = (PATTERN_MARGIN_X + view.scrollX) * zoomScale;
      if (x >= -lineWidth && x <= view.width + lineWidth) {
        context.globalAlpha = pattern.opacity;
        context.fillStyle = resolveColor(colors.margin, view.isDarkMode);
        fillLine(context, true, x, lineWidth, view.height);
      }
    }
    return;
  }

  const majors = hasMajorLines(pattern);
  const skipEvery = majors ? pattern.majorEvery : 0;
  const majorStep = minorStep * pattern.majorEvery;
  const majorAlpha = majors
    ? colors.majorAlpha * patternLevelAlpha(majorStep * view.zoom)
    : 0;
  const majorColor = resolveColor(colors.major, view.isDarkMode);

  for (let axis = 0; axis < 2; axis++) {
    const vertical = axis === 0;
    drawLevel(
      context,
      vertical,
      view,
      minorStep,
      skipEvery,
      minorColor,
      minorAlpha,
      lineWidth,
    );
    if (majors) {
      drawLevel(
        context,
        vertical,
        view,
        majorStep,
        0,
        majorColor,
        majorAlpha,
        lineWidth,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// dots (dots, isometric): dot strips, or one path without a canvas
// ---------------------------------------------------------------------------

const dot = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) => {
  context.moveTo(x + radius, y);
  context.arc(x, y, radius, 0, Math.PI * 2);
};

/**
 * Dot strips: one canvas per sub-pixel row phase
 * (DOT_ROW_PHASES, plus as many shifted by half a gap for isometric), each
 * `cell` px tall with one row of dots at y = center + phase / DOT_ROW_PHASES
 * and at the exact device x of every visible column. Separate canvases, not
 * one atlas: copying a whole canvas is much faster than a source sub-rect in
 * Chromium. Depends only on the column layout, so vertical pans reuse them.
 */
const stripCache: {
  canvases: HTMLCanvasElement[];
  count: number;
  width: number;
  gapX: number;
  phaseX: number;
  radius: number;
  color: string;
  cell: number;
  center: number;
} = {
  canvases: [],
  count: 0,
  width: 0,
  gapX: 0,
  phaseX: 0,
  radius: 0,
  color: "",
  cell: 0,
  center: 0,
};

/** Returns the (cached) dot strips, or null when no canvas is available. */
const getDotStrips = (
  width: number,
  gapX: number,
  originX: number,
  radius: number,
  color: string,
  isometric: boolean,
) => {
  if (typeof document === "undefined") {
    return null;
  }
  const cache = stripCache;
  const count = DOT_ROW_PHASES * (isometric ? 2 : 1);
  const phaseX = mod(originX, gapX);
  if (
    cache.count === count &&
    cache.width === width &&
    cache.gapX === gapX &&
    cache.phaseX === phaseX &&
    cache.radius === radius &&
    cache.color === color
  ) {
    return cache;
  }
  cache.count = 0;
  // the dot spans y in [center - radius, center + 1 + radius] at any phase
  const center = Math.ceil(radius);
  const cell = Math.ceil(center + 1 + radius);
  const columns = Math.ceil(width / gapX) + 1;
  for (let index = 0; index < count; index++) {
    const canvas =
      cache.canvases[index] ??
      (cache.canvases[index] = document.createElement("canvas"));
    const strip = canvas.getContext("2d");
    if (!strip || typeof strip.drawImage !== "function") {
      return null;
    }
    if (canvas.width !== width || canvas.height !== cell) {
      canvas.width = width; // also clears
      canvas.height = cell;
    } else {
      strip.clearRect(0, 0, width, cell);
    }
    const y = center + (index % DOT_ROW_PHASES) / DOT_ROW_PHASES;
    const shift = index >= DOT_ROW_PHASES ? gapX / 2 : 0;
    strip.fillStyle = color;
    strip.beginPath();
    for (let column = -1; column <= columns; column++) {
      dot(strip, phaseX + shift + column * gapX, y, radius);
    }
    strip.fill();
  }
  cache.count = count;
  cache.width = width;
  cache.gapX = gapX;
  cache.phaseX = phaseX;
  cache.radius = radius;
  cache.color = color;
  cache.cell = cell;
  cache.center = center;
  return cache;
};

/** Moves `origin` by at most half a pixel so that `origin - inset` sits on
 * a whole pixel within its cell. */
const snapCellCorner = (origin: number, gap: number, inset: number) => {
  const offset = mod(origin - inset, gap);
  return origin + Math.round(offset) - offset;
};

const renderDots = (
  context: CanvasRenderingContext2D,
  pattern: BackgroundPattern,
  view: BackgroundPatternView,
) => {
  const gapPx = pattern.spacing * view.zoom;
  const levelAlpha = patternLevelAlpha(gapPx);
  const colors = getPatternColors(pattern);
  const alpha = colors.minorAlpha * levelAlpha;
  if (alpha <= 0) {
    return;
  }
  const color = resolveColor(colors.minor, view.isDarkMode);
  const isometric = pattern.type === "isometric";
  const zoomScale = view.zoom * view.scale;
  const gapX = pattern.spacing * zoomScale;
  const gapY =
    (isometric ? getIsometricRowHeight(pattern.spacing) * 2 : pattern.spacing) *
    zoomScale;
  const radius = getPatternDotRadiusPx(gapPx) * view.scale;
  let originX = view.scrollX * zoomScale;
  let originY = view.scrollY * zoomScale;
  if (
    Math.abs(gapX - Math.round(gapX)) < 1e-3 &&
    Math.abs(gapY - Math.round(gapY)) < 1e-3
  ) {
    // whole-pixel gap (e.g. zoom 1): put each cell's corner on a whole pixel,
    // as the tile-based renderer did, so dots look the same at rest
    originX = snapCellCorner(originX, gapX, gapX / 2);
    originY = snapCellCorner(originY, gapY, gapY / (isometric ? 4 : 2));
  }

  const rowGap = isometric ? gapY / 2 : gapY;
  const firstRow = Math.ceil(-originY / rowGap) - 1;
  const lastRow = Math.floor((view.height - originY) / rowGap) + 1;
  context.globalAlpha = alpha;
  context.fillStyle = color;

  const strips = getDotStrips(
    view.width,
    gapX,
    originX,
    radius,
    color,
    isometric,
  );
  if (strips) {
    // one copy per row, at a whole-pixel y with the nearest sub-pixel phase
    const { canvases, center } = strips;
    for (let row = firstRow; row <= lastRow; row++) {
      const y = originY + row * rowGap;
      let top = Math.floor(y);
      let phase = Math.round((y - top) * DOT_ROW_PHASES);
      if (phase === DOT_ROW_PHASES) {
        top++;
        phase = 0;
      }
      if (isometric && mod(row, 2) === 1) {
        phase += DOT_ROW_PHASES;
      }
      context.drawImage(canvases[phase], 0, top - center);
    }
    return;
  }

  // no canvas for strips: one path with every visible dot
  const firstColumn = Math.ceil(-originX / gapX) - 1;
  const lastColumn = Math.floor((view.width - originX) / gapX) + 1;
  if (
    (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1) >
    MAX_PATTERN_FALLBACK_DOTS
  ) {
    return;
  }
  context.beginPath();
  for (let row = firstRow; row <= lastRow; row++) {
    const y = originY + row * rowGap;
    const shift = isometric && mod(row, 2) === 1 ? gapX / 2 : 0;
    for (let column = firstColumn; column <= lastColumn; column++) {
      dot(context, originX + shift + column * gapX, y, radius);
    }
  }
  context.fill();
};

// ---------------------------------------------------------------------------

export const renderBackgroundPattern = (
  context: CanvasRenderingContext2D,
  pattern: BackgroundPattern,
  view: BackgroundPatternView,
) => {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (pattern.type === "dots" || pattern.type === "isometric") {
    renderDots(context, pattern, view);
  } else {
    renderLines(context, pattern, view);
  }
  context.restore();
};
