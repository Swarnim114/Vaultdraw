/**
 * Notebook backgrounds: the paper pattern drawn behind a drawing (grid,
 * ruled lines, dots, graph paper, isometric dots).
 *
 * Saved in the drawing's appState as `viewBackgroundPattern` (null = plain),
 * anchored to scene coordinates. This module is the shared model: types,
 * defaults, validation of untrusted input and the level-of-detail math used
 * by both the canvas and the SVG renderer. No DOM, no React.
 */

import { COLOR_PALETTE } from "@excalidraw/common";

export const BACKGROUND_PATTERN_TYPES = [
  "grid",
  "lines",
  "dots",
  "graph",
  "isometric",
] as const;

export type BackgroundPatternType = typeof BACKGROUND_PATTERN_TYPES[number];

export interface BackgroundPattern {
  type: BackgroundPatternType;
  /** Distance between minor lines / dots, in scene units. */
  spacing: number;
  /** "#rrggbb"; null = the style's automatic palette colours. */
  color: string | null;
  /** 0.1 to 1. */
  opacity: number;
  /** Grid and graph: a major line every N minor lines; 1 = none. */
  majorEvery: number;
  /** Ruled lines: vertical margin line at PATTERN_MARGIN_X. */
  marginLine: boolean;
}

export const BACKGROUND_PATTERN_LIMITS = {
  spacing: { min: 5, max: 200 },
  opacity: { min: 0.1, max: 1 },
  majorEvery: { min: 1, max: 20 },
} as const;

const BASE: Omit<BackgroundPattern, "type"> = {
  spacing: 20,
  color: null,
  opacity: 1,
  majorEvery: 1,
  marginLine: false,
};

/** Per-style starting values (the "preset" a style begins with). */
export const DEFAULT_BACKGROUND_PATTERNS: Readonly<
  Record<BackgroundPatternType, Readonly<BackgroundPattern>>
> = {
  grid: { ...BASE, type: "grid", spacing: 20, majorEvery: 5 },
  lines: { ...BASE, type: "lines", spacing: 32, marginLine: true },
  dots: { ...BASE, type: "dots", spacing: 20 },
  graph: { ...BASE, type: "graph", spacing: 10, majorEvery: 10 },
  isometric: { ...BASE, type: "isometric", spacing: 24 },
};

/**
 * Automatic colours: Excalidraw palette shades, so "Sync canvas with theme"
 * maps them onto the theme's ramp on screen (the display colour transform
 * knows every palette colour) while files and exports keep these values.
 */
export const AUTO_PATTERN_COLORS: Readonly<
  Record<BackgroundPatternType, { minor: string; major: string }>
> = {
  grid: { minor: COLOR_PALETTE.gray[1], major: COLOR_PALETTE.gray[2] },
  lines: { minor: COLOR_PALETTE.blue[1], major: COLOR_PALETTE.blue[1] },
  dots: { minor: COLOR_PALETTE.gray[2], major: COLOR_PALETTE.gray[2] },
  graph: { minor: COLOR_PALETTE.blue[0], major: COLOR_PALETTE.blue[1] },
  isometric: { minor: COLOR_PALETTE.gray[2], major: COLOR_PALETTE.gray[2] },
};

export const PATTERN_MARGIN_COLOR = COLOR_PALETTE.red[1];
/** Scene x of the ruled-paper margin line. */
export const PATTERN_MARGIN_X = 80;
/** With a custom colour, minor lines are drawn at this share of its alpha. */
export const PATTERN_MINOR_ALPHA = 0.5;

/** Below this on-screen gap (CSS px) a level is not drawn at all. */
export const PATTERN_MIN_GAP_PX = 8;
/** From this gap up a level is drawn at full strength (fades in between). */
export const PATTERN_FULL_GAP_PX = 16;

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const isBackgroundPatternType = (
  value: unknown,
): value is BackgroundPatternType =>
  (BACKGROUND_PATTERN_TYPES as readonly unknown[]).includes(value);

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampTo = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value));

/** A fresh pattern of `type` with its preset values, optionally overridden. */
export const createBackgroundPattern = (
  type: BackgroundPatternType,
  overrides: Partial<Omit<BackgroundPattern, "type">> = {},
): BackgroundPattern =>
  normalizeBackgroundPattern({
    ...DEFAULT_BACKGROUND_PATTERNS[type],
    ...overrides,
    type,
  })!;

/**
 * Untrusted input (file, config, UI) -> a valid pattern or null (plain).
 * Unknown types give null; bad fields fall back to the style's preset;
 * numbers are clamped to BACKGROUND_PATTERN_LIMITS.
 */
export const normalizeBackgroundPattern = (
  input: unknown,
): BackgroundPattern | null => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (!isBackgroundPatternType(raw.type)) {
    return null;
  }
  const preset = DEFAULT_BACKGROUND_PATTERNS[raw.type];
  const limits = BACKGROUND_PATTERN_LIMITS;
  return {
    type: raw.type,
    spacing: clampTo(finite(raw.spacing, preset.spacing), limits.spacing),
    color:
      typeof raw.color === "string" && HEX_RE.test(raw.color)
        ? raw.color.toLowerCase()
        : null,
    opacity: clampTo(finite(raw.opacity, preset.opacity), limits.opacity),
    majorEvery: Math.round(
      clampTo(finite(raw.majorEvery, preset.majorEvery), limits.majorEvery),
    ),
    marginLine:
      typeof raw.marginLine === "boolean" ? raw.marginLine : preset.marginLine,
  };
};

/** Stable string identity (change detection, memo keys). "" = plain. */
export const backgroundPatternKey = (
  pattern: BackgroundPattern | null | undefined,
): string =>
  pattern
    ? `${pattern.type}:${pattern.spacing}:${pattern.color ?? ""}:${
        pattern.opacity
      }:${pattern.majorEvery}:${pattern.marginLine ? 1 : 0}`
    : "";

export const isSameBackgroundPattern = (
  a: BackgroundPattern | null | undefined,
  b: BackgroundPattern | null | undefined,
) => backgroundPatternKey(a) === backgroundPatternKey(b);

/** Whether majors exist for this pattern (grid / graph with majorEvery > 1). */
export const hasMajorLines = (pattern: BackgroundPattern) =>
  (pattern.type === "grid" || pattern.type === "graph") &&
  pattern.majorEvery > 1;

/** Standard (untransformed) colours + alpha per level. */
export const getPatternColors = (pattern: BackgroundPattern) => {
  const majors = hasMajorLines(pattern);
  if (pattern.color) {
    return {
      minor: pattern.color,
      minorAlpha: pattern.opacity * (majors ? PATTERN_MINOR_ALPHA : 1),
      major: pattern.color,
      majorAlpha: pattern.opacity,
      margin: PATTERN_MARGIN_COLOR,
    };
  }
  const auto = AUTO_PATTERN_COLORS[pattern.type];
  return {
    minor: auto.minor,
    minorAlpha: pattern.opacity,
    major: auto.major,
    majorAlpha: pattern.opacity,
    margin: PATTERN_MARGIN_COLOR,
  };
};

/**
 * Level-of-detail fade for a level whose on-screen gap is `gapPx` CSS px:
 * 0 below PATTERN_MIN_GAP_PX, 1 from PATTERN_FULL_GAP_PX, linear between.
 */
export const patternLevelAlpha = (gapPx: number) =>
  gapPx <= PATTERN_MIN_GAP_PX
    ? 0
    : gapPx >= PATTERN_FULL_GAP_PX
    ? 1
    : (gapPx - PATTERN_MIN_GAP_PX) / (PATTERN_FULL_GAP_PX - PATTERN_MIN_GAP_PX);

/** Dot radius in CSS px for a dot gap of `gapPx` CSS px. */
export const getPatternDotRadiusPx = (gapPx: number) =>
  Math.min(1.75, Math.max(0.75, gapPx * 0.06));

/** Isometric lattice: rows are this far apart (scene units). */
export const getIsometricRowHeight = (spacing: number) =>
  (spacing * Math.sqrt(3)) / 2;
