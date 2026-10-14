/**
 * Pen presets: the saved pens of the freedraw tool. Pure data and validation;
 * no React, no Tauri. Stored in config.toml as `[pens] presets = [ {...} ]`.
 */

export interface PenPreset {
  name: string;
  /** Stroke colour (hex or CSS name). */
  color: string;
  /** Visual stroke thickness in px (the widest point for pressure pens). The element strokeWidth is derived from it, see penApply. */
  width: number;
  /** 1 to 100. */
  opacity: number;
  /** true = variable width (pressure / speed), false = constant width. */
  pressure: boolean;
  /** perfect-freehand streamline, 0 (raw) to 1 (very smooth). */
  smoothing: number;
  /** Drawn behind every other element, see PLAN.md. */
  highlighter: boolean;
}

/** One "pen.selectN" command each (Alt+1 .. Alt+9 by default). */
export const MAX_PEN_PRESETS = 9;
export const MIN_PEN_WIDTH = 0.5;
export const MAX_PEN_WIDTH = 40;

export const DEFAULT_PEN_PRESETS: readonly PenPreset[] = [
  {
    name: "Fine liner",
    color: "#1e1e1e",
    width: 0.5,
    opacity: 100,
    pressure: false,
    smoothing: 0.3,
    highlighter: false,
  },
  {
    name: "Marker",
    color: "#1e1e1e",
    width: 2,
    opacity: 100,
    pressure: false,
    smoothing: 0.5,
    highlighter: false,
  },
  {
    name: "Brush",
    color: "#1e1e1e",
    width: 1.5,
    opacity: 100,
    pressure: true,
    smoothing: 0.6,
    highlighter: false,
  },
  {
    name: "Red pen",
    color: "#e03131",
    width: 1,
    opacity: 100,
    pressure: false,
    smoothing: 0.4,
    highlighter: false,
  },
  {
    name: "Highlighter",
    color: "#ffd43b",
    width: 10,
    opacity: 40,
    pressure: false,
    smoothing: 0.5,
    highlighter: true,
  },
];

const COLOR_RE =
  /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|[a-z]+)$/i;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Why a value is not a usable preset, or null when it is. */
export function penPresetProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "is not a table";
  }
  const p = value as Record<string, unknown>;
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 40) {
    return "needs a name (1 to 40 characters)";
  }
  if (typeof p.color !== "string" || !COLOR_RE.test(p.color)) {
    return `has an invalid color ${JSON.stringify(p.color)}`;
  }
  if (
    !isFiniteNumber(p.width) ||
    p.width < MIN_PEN_WIDTH ||
    p.width > MAX_PEN_WIDTH
  ) {
    return `needs a width between ${MIN_PEN_WIDTH} and ${MAX_PEN_WIDTH}`;
  }
  if (!isFiniteNumber(p.opacity) || p.opacity < 1 || p.opacity > 100) {
    return "needs an opacity between 1 and 100";
  }
  if (typeof p.pressure !== "boolean") {
    return "needs pressure = true or false";
  }
  if (!isFiniteNumber(p.smoothing) || p.smoothing < 0 || p.smoothing > 1) {
    return "needs a smoothing between 0 and 1";
  }
  if (typeof p.highlighter !== "boolean") {
    return "needs highlighter = true or false";
  }
  return null;
}

/**
 * Config value check for `pens.presets`: a list of 1 to MAX_PEN_PRESETS
 * valid presets. Missing optional fields are filled by `normalizePenPresets`
 * before this runs, so hand-written entries may omit them.
 */
export const isPenPresets = (value: unknown): value is PenPreset[] =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= MAX_PEN_PRESETS &&
  value.every((p) => penPresetProblem(p) === null);

/**
 * Fills the optional fields of hand-written entries (`opacity`, `pressure`,
 * `smoothing`, `highlighter`) with the marker's values. Anything that is not
 * an array of tables is returned unchanged so validation can reject it.
 */
export function withPenDefaults(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((p) =>
    p && typeof p === "object" && !Array.isArray(p)
      ? {
          opacity: 100,
          pressure: false,
          smoothing: 0.5,
          highlighter: false,
          ...p,
        }
      : p,
  );
}
