/**
 * Tool defaults, canvas side: pure mapping between a saved ToolStyle and the
 * editor's current-item state, plus the enter/leave logic of a tool switch.
 * No React, no editor instance.
 */
import { STROKE_WIDTH, STROKE_WIDTH_KEYS } from "@excalidraw/common";
import { isArrowElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  NewContainerStyle,
  NewTextStyle,
} from "@excalidraw/excalidraw/types";

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

/** Every AppState field a style key drives (the only ones the recorder diffs). */
export const STYLE_FIELDS: readonly Field[] = (
  Object.keys(MAPPING) as ToolStyleKey[]
).map((key) => MAPPING[key].field);

/** The style key behind an AppState field, if it is one of the mapped ones. */
export const styleKeyOfField = (field: Field): ToolStyleKey | undefined =>
  (Object.keys(MAPPING) as ToolStyleKey[]).find(
    (key) => MAPPING[key].field === field,
  );

/** The AppState field of a style key. */
export const fieldOfStyleKey = (key: ToolStyleKey): Field => MAPPING[key].field;

/** A key's current value in `appState`, in style terms (stroke width in px). */
export const styleKeyValue = (
  key: ToolStyleKey,
  appState: Partial<AppState>,
): unknown => MAPPING[key].fromState(appState[MAPPING[key].field]);

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
  /** The styled tool being used, else null. */
  tool: StyledTool | null;
  /** Values we set, by AppState field. */
  applied: Loose;
  /** The values all of the tool's fields had before it was entered. */
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

/** Every AppState field a tool's style keys drive. */
const allFieldsOf = (tool: StyledTool): Field[] =>
  TOOL_STYLE_KEYS[tool].map((key) => MAPPING[key].field);

/**
 * The style the tool was last used with: its keys read from the editor state
 * seen while it was active. Stroke width keeps the applied px while the width
 * key is untouched, so a 3 px style round-trips.
 */
export function captureToolStyle(
  session: ToolSession,
  leaving: string | null,
  seen: Partial<AppState> | null,
): ToolStyle | null {
  if (!isStyledTool(leaving) || !seen) {
    return null;
  }
  const keepPx =
    session.tool === leaving &&
    session.strokeWidthPx !== null &&
    seen.currentItemStrokeWidthKey ===
      session.applied.currentItemStrokeWidthKey;
  return styleFromAppState(
    leaving,
    seen,
    keepPx ? session.strokeWidthPx : null,
  );
}

/**
 * Leave the session's tool, enter `nextTool`. Returns the AppState patch to
 * apply (only fields that change) and the new session. `styles` is what each
 * tool starts with (remembered style, else saved default). Leaving restores
 * every field the tool owns whose value is unchanged since `lastSeen` (a
 * value set in the same transition, e.g. a pen preset, wins), so one tool's
 * style never leaks into another. Entering a styled tool takes its base from
 * the restored values, so A -> B composes into one patch. Calling it with the
 * active tool again re-applies the (changed) styles.
 */
export function switchTool(
  session: ToolSession,
  nextTool: string | null,
  appState: Partial<AppState>,
  styles: ToolDefaults,
): { patch: Partial<AppState>; session: ToolSession } {
  const patch: Loose = {};
  const current = appState as Loose;
  const seen = (session.lastSeen ?? appState) as Loose;
  for (const field of Object.keys(session.base)) {
    if (current[field] === seen[field]) {
      patch[field] = session.base[field];
    }
  }
  let next = newToolSession();
  if (isStyledTool(nextTool)) {
    const style = styles[nextTool];
    const base: Loose = {};
    for (const field of allFieldsOf(nextTool)) {
      base[field] = field in patch ? patch[field] : current[field];
    }
    const hasStyle = !!style && !isEmptyStyle(style);
    const applied = hasStyle ? (styleToAppState(nextTool, style) as Loose) : {};
    Object.assign(patch, applied);
    next = {
      tool: nextTool,
      applied,
      base,
      strokeWidthPx: hasStyle ? style.stroke_width ?? null : null,
      lastSeen: session.lastSeen,
    };
  }
  for (const field of Object.keys(patch)) {
    if (patch[field] === current[field]) {
      delete patch[field];
    }
  }
  return { patch: patch as Partial<AppState>, session: next };
}

/**
 * A text style as the fields of a new text element (what the editor's
 * `newTextStyle` hook returns). Unset keys are left out.
 */
export function newTextStyleOf(style: ToolStyle): NewTextStyle {
  const out: Loose = {
    strokeColor: style.stroke_color,
    opacity: style.opacity,
    fontFamily: style.font_family,
    fontSize: style.font_size,
    textAlign: style.text_align,
  };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) {
      delete out[key];
    }
  }
  return out as NewTextStyle;
}

/**
 * A rectangle style as the fields of a wrapping container (what the editor's
 * `newContainerStyle` hook returns). Unset keys are left out.
 */
export function newContainerStyleOf(style: ToolStyle): NewContainerStyle {
  const out: Loose = {
    strokeColor: style.stroke_color,
    backgroundColor: style.background_color,
    fillStyle: style.fill_style,
    strokeWidth: style.stroke_width,
    strokeStyle: style.stroke_style,
    roughness: style.roughness,
    opacity: style.opacity,
    roundness: style.roundness,
  };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) {
      delete out[key];
    }
  }
  return out as NewContainerStyle;
}
