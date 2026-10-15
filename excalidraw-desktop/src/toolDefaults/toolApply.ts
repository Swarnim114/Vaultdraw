/**
 * Tool defaults, canvas side: pure mapping between a saved ToolStyle and the
 * editor's current-item state, plus the enter/leave logic of a tool switch.
 * No React, no editor instance.
 */
import { STROKE_WIDTH, STROKE_WIDTH_KEYS } from "@excalidraw/common";
import { isArrowElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import {
  STYLE_KEY_RULES,
  TOOL_STYLE_KEYS,
  isEmptyStyle,
  isStyledTool,
  type StyledTool,
  type ToolDefaults,
  type ToolStyle,
  type ToolStyleKey,
} from "./toolStyles";

type Field = keyof AppState;
type Loose = Record<string, unknown>;

interface KeyMapping {
  /** The AppState field holding this key's current value. */
  field: Field;
  /** Style value -> AppState value. */
  toState: (value: never) => unknown;
  /** AppState value -> style value. */
  fromState: (value: unknown) => unknown;
  /** Element -> style value. */
  fromElement: (element: ExcalidrawElement) => unknown;
}

const same = (v: unknown) => v;

const direct = (field: Field, prop: string): KeyMapping => ({
  field,
  toState: same,
  fromState: same,
  fromElement: (el) => (el as unknown as Loose)[prop],
});

const arrowhead = (
  field: Field,
  prop: "startArrowhead" | "endArrowhead",
): KeyMapping => ({
  field,
  toState: (v: string) => (v === "none" ? null : v),
  fromState: (v) => v ?? "none",
  fromElement: (el) => (el as unknown as Loose)[prop] ?? "none",
});

/** Nearest of thin 1 / medium 2 / bold 4; ties go to the lower one. */
export function nearestStrokeWidthKey(px: number) {
  let best = STROKE_WIDTH_KEYS[0];
  for (const key of STROKE_WIDTH_KEYS) {
    if (Math.abs(STROKE_WIDTH[key] - px) < Math.abs(STROKE_WIDTH[best] - px)) {
      best = key;
    }
  }
  return best;
}

/** The one table behind every direction of the style <-> editor mapping. */
const MAPPING: Record<ToolStyleKey, KeyMapping> = {
  stroke_color: direct("currentItemStrokeColor", "strokeColor"),
  background_color: direct("currentItemBackgroundColor", "backgroundColor"),
  fill_style: direct("currentItemFillStyle", "fillStyle"),
  stroke_width: {
    field: "currentItemStrokeWidthKey",
    toState: (px: number) => nearestStrokeWidthKey(px),
    fromState: (key) => STROKE_WIDTH[key as keyof typeof STROKE_WIDTH],
    fromElement: (el) => el.strokeWidth,
  },
  stroke_style: direct("currentItemStrokeStyle", "strokeStyle"),
  roughness: direct("currentItemRoughness", "roughness"),
  roundness: {
    field: "currentItemRoundness",
    toState: same,
    fromState: same,
    fromElement: (el) => (el.roundness === null ? "sharp" : "round"),
  },
  opacity: direct("currentItemOpacity", "opacity"),
  arrow_type: {
    field: "currentItemArrowType",
    toState: same,
    fromState: same,
    fromElement: (el) =>
      !isArrowElement(el)
        ? undefined
        : el.elbowed
        ? "elbow"
        : el.roundness
        ? "round"
        : "sharp",
  },
  start_arrowhead: arrowhead("currentItemStartArrowhead", "startArrowhead"),
  end_arrowhead: arrowhead("currentItemEndArrowhead", "endArrowhead"),
  font_family: direct("currentItemFontFamily", "fontFamily"),
  font_size: direct("currentItemFontSize", "fontSize"),
  text_align: direct("currentItemTextAlign", "textAlign"),
};

/** The AppState field each of the tool's keys drives. */
const fieldsOf = (style: ToolStyle, tool: StyledTool): Field[] =>
  TOOL_STYLE_KEYS[tool]
    .filter((key) => style[key] !== undefined)
    .map((key) => MAPPING[key].field);

/** AppState patch for the keys the style sets (and the tool understands). */
export function styleToAppState(
  tool: StyledTool,
  style: ToolStyle,
): Partial<AppState> {
  const patch: Loose = {};
  for (const key of TOOL_STYLE_KEYS[tool]) {
    const value = style[key];
    if (value !== undefined) {
      const { field, toState } = MAPPING[key];
      patch[field] = (toState as (v: unknown) => unknown)(value);
    }
  }
  return patch as Partial<AppState>;
}

/** Full style of a tool from `read`; values the rules reject are dropped. */
function collectStyle(
  tool: StyledTool,
  read: (key: ToolStyleKey) => unknown,
): ToolStyle {
  const out: Loose = {};
  for (const key of TOOL_STYLE_KEYS[tool]) {
    const value = read(key);
    if (STYLE_KEY_RULES[key].valid(value)) {
      out[key] = value;
    }
  }
  return out as ToolStyle;
}

/** The editor's current style for `tool`; `strokeWidthPx` overrides the key's px. */
export const styleFromAppState = (
  tool: StyledTool,
  appState: Partial<AppState>,
  strokeWidthPx?: number | null,
): ToolStyle =>
  collectStyle(tool, (key) =>
    key === "stroke_width" && strokeWidthPx != null
      ? strokeWidthPx
      : MAPPING[key].fromState(appState[MAPPING[key].field]),
  );

/** The style of an existing element (what "save current style" reads). */
export const styleFromElement = (
  tool: StyledTool,
  element: ExcalidrawElement,
): ToolStyle => collectStyle(tool, (key) => MAPPING[key].fromElement(element));

/**
 * What a tool switch applied. `lastSeen` is the editor state observed before
 * the switch (the hook keeps it current; read lazily, never copied).
 */
export interface ToolSession {
  /** The configured tool whose style is applied, else null. */
  tool: StyledTool | null;
  /** Values we set, by AppState field. */
  applied: Loose;
  /** The values those fields had before we applied. */
  base: Loose;
  /** Stroke width in px of the applied style (null when it sets none). */
  strokeWidthPx: number | null;
  lastSeen: Partial<AppState> | null;
}

export const newToolSession = (): ToolSession => ({
  tool: null,
  applied: {},
  base: {},
  strokeWidthPx: null,
  lastSeen: null,
});

/**
 * Leave the session's tool, enter `nextTool`. Returns the AppState patch to
 * apply and the new session. Leaving restores each applied field whose value
 * is unchanged since `lastSeen` (a value set in the same transition, e.g. a
 * pen preset, wins). Entering a configured tool takes its base from the
 * restored values, so A -> B composes into one patch. Calling it with the
 * active tool again re-applies the (changed) defaults.
 */
export function switchTool(
  session: ToolSession,
  nextTool: string | null,
  appState: Partial<AppState>,
  defaults: ToolDefaults,
): { patch: Partial<AppState>; session: ToolSession } {
  const patch: Loose = {};
  const current = appState as Loose;
  const seen = (session.lastSeen ?? appState) as Loose;
  for (const field of Object.keys(session.applied)) {
    if (current[field] === seen[field]) {
      patch[field] = session.base[field];
    }
  }
  const style = isStyledTool(nextTool) ? defaults[nextTool] : undefined;
  if (!isStyledTool(nextTool) || !style || isEmptyStyle(style)) {
    return { patch: patch as Partial<AppState>, session: newToolSession() };
  }
  const base: Loose = {};
  for (const field of fieldsOf(style, nextTool)) {
    base[field] = field in patch ? patch[field] : current[field];
  }
  const applied = styleToAppState(nextTool, style) as Loose;
  Object.assign(patch, applied);
  return {
    patch: patch as Partial<AppState>,
    session: {
      tool: nextTool,
      applied,
      base,
      strokeWidthPx: style.stroke_width ?? null,
      lastSeen: session.lastSeen,
    },
  };
}
