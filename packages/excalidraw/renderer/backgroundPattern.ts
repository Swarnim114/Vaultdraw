/**
 * Canvas renderer for notebook backgrounds (see data/backgroundPattern.ts).
 *
 * Draws in device pixels with an identity transform so lines land on whole
 * pixels and dots stay locked to scene coordinates: scene -> device is
 * `(x + scroll) * zoom * scale`. Steady-state frames allocate nothing: line
 * levels are one path each, dots/isometric use a cached CanvasPattern tile
 * that only changes with zoom/colour/dpr (panning just updates its matrix).
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
/** The fallback path draws at most this many dots per frame. */
export const MAX_PATTERN_FALLBACK_DOTS = 20000;
/** Largest tile edge (device px) the CanvasPattern path accepts. */
export const MAX_PATTERN_TILE_PX = 256;

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
 * One path with every visible line of a level (scene positions k * step,
 * k in [first, last]), skipping multiples of `skipEvery` (0 = none).
 * `origin` is the scroll on the line's axis, `deviceStep` = step * zoom *
 * scale. Skips the level when it is over the line cap.
 */
const strokeLevel = (
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
  const center = lineWidth % 2 ? 0.5 : 0;
  let drawn = false;
  context.beginPath();
  for (let k = first; k <= last; k++) {
    if (skipEvery && k % skipEvery === 0) {
      continue;
    }
    const position =
      Math.round((k * step + origin) * zoomScale - center) + center;
    if (vertical) {
      context.moveTo(position, 0);
      context.lineTo(position, length);
    } else {
      context.moveTo(0, position);
      context.lineTo(length, position);
    }
    drawn = true;
  }
  if (drawn) {
    context.lineWidth = lineWidth;
    context.stroke();
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
  context.strokeStyle = color;
  strokeLevel(
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
        const center = lineWidth % 2 ? 0.5 : 0;
        const position = Math.round(x - center) + center;
        context.globalAlpha = pattern.opacity;
        context.strokeStyle = resolveColor(colors.margin, view.isDarkMode);
        context.lineWidth = lineWidth;
        context.beginPath();
        context.moveTo(position, 0);
        context.lineTo(position, view.height);
        context.stroke();
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
// dots (dots, isometric): cached CanvasPattern tile
// ---------------------------------------------------------------------------

const tileCache: {
  canvas: HTMLCanvasElement | null;
  pattern: CanvasPattern | null;
  matrix: DOMMatrix | null;
  isometric: boolean;
  width: number;
  height: number;
  radius: number;
  color: string;
} = {
  canvas: null,
  pattern: null,
  matrix: null,
  isometric: false,
  width: 0,
  height: 0,
  radius: 0,
  color: "",
};

const dot = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) => {
  context.moveTo(x + radius, y);
  context.arc(x, y, radius, 0, Math.PI * 2);
};

/** Returns the (cached) pattern for the tile, or null when unsupported. */
const getTilePattern = (
  context: CanvasRenderingContext2D,
  isometric: boolean,
  width: number,
  height: number,
  radius: number,
  color: string,
) => {
  if (
    typeof context.createPattern !== "function" ||
    typeof DOMMatrix === "undefined" ||
    typeof document === "undefined"
  ) {
    return null;
  }
  const cache = tileCache;
  if (
    cache.pattern &&
    cache.isometric === isometric &&
    cache.width === width &&
    cache.height === height &&
    cache.radius === radius &&
    cache.color === color
  ) {
    return cache.pattern;
  }
  const canvas =
    cache.canvas ?? (cache.canvas = document.createElement("canvas"));
  canvas.width = width; // also clears
  canvas.height = height;
  const tile = canvas.getContext("2d");
  if (!tile) {
    return null;
  }
  tile.fillStyle = color;
  tile.beginPath();
  if (isometric) {
    // scene (0,0) at (w/2, h/4); the odd row's dots at x = 0 and w, h * 3/4
    dot(tile, width / 2, height / 4, radius);
    dot(tile, 0, (height * 3) / 4, radius);
    dot(tile, width, (height * 3) / 4, radius);
  } else {
    dot(tile, width / 2, height / 2, radius);
  }
  tile.fill();
  const pattern = context.createPattern(canvas, "repeat");
  if (!pattern || typeof pattern.setTransform !== "function") {
    cache.pattern = null;
    return null;
  }
  cache.pattern = pattern;
  cache.isometric = isometric;
  cache.width = width;
  cache.height = height;
  cache.radius = radius;
  cache.color = color;
  cache.matrix = cache.matrix ?? new DOMMatrix();
  return pattern;
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
  const originX = view.scrollX * zoomScale;
  const originY = view.scrollY * zoomScale;

  const tileWidth = Math.round(gapX);
  const tileHeight = Math.round(gapY);
  context.globalAlpha = alpha;
  context.fillStyle = color;

  if (
    tileWidth >= 1 &&
    tileHeight >= 1 &&
    tileWidth <= MAX_PATTERN_TILE_PX &&
    tileHeight <= MAX_PATTERN_TILE_PX
  ) {
    const tile = getTilePattern(
      context,
      isometric,
      tileWidth,
      tileHeight,
      radius,
      color,
    );
    if (tile) {
      const m = tileCache.matrix!;
      m.a = gapX / tileWidth;
      m.b = 0;
      m.c = 0;
      m.d = gapY / tileHeight;
      // tile origin sits half a cell before scene (0, 0)
      m.e = mod(originX - gapX / 2, gapX);
      m.f = mod(originY - gapY / (isometric ? 4 : 2), gapY);
      tile.setTransform(m);
      context.fillStyle = tile;
      context.fillRect(0, 0, view.width, view.height);
      return;
    }
  }

  // fallback: one path with every visible dot (few at this size)
  const rowGap = isometric ? gapY / 2 : gapY;
  const firstColumn = Math.ceil(-originX / gapX) - 1;
  const lastColumn = Math.floor((view.width - originX) / gapX) + 1;
  const firstRow = Math.ceil(-originY / rowGap) - 1;
  const lastRow = Math.floor((view.height - originY) / rowGap) + 1;
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
