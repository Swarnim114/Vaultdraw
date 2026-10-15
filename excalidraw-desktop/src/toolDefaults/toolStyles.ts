/**
 * Tool defaults: the saved default style of each drawing tool. Pure data and
 * validation; no React, no Tauri. Stored as one table per tool in config.toml
 * and (per vault) in settings.toml:
 *
 *   [tools.arrow]
 *   stroke_color = "#f08c00"
 *   stroke_width = 3
 *   stroke_style = "dotted"
 *
 * A style holds only the keys the user set; every other key keeps the
 * editor's current (shared) value. Keys are the config spelling (snake_case)
 * so a style round-trips through config.toml unchanged.
 */

/** Tools that can have a default style. Freedraw belongs to the pen presets. */
export const TOOL_DEFAULT_TOOLS = [
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "text",
] as const;
export type StyledTool = typeof TOOL_DEFAULT_TOOLS[number];

export const TOOL_LABELS: Record<StyledTool, string> = {
  rectangle: "Rectangle",
  diamond: "Diamond",
  ellipse: "Ellipse",
  arrow: "Arrow",
  line: "Line",
  text: "Text",
};

export const isStyledTool = (v: unknown): v is StyledTool =>
  (TOOL_DEFAULT_TOOLS as readonly unknown[]).includes(v);

export const FILL_STYLE_VALUES = [
  "hachure",
  "cross-hatch",
  "solid",
  "zigzag",
] as const;
export const STROKE_STYLE_VALUES = ["solid", "dashed", "dotted"] as const;
export const ROUNDNESS_VALUES = ["sharp", "round"] as const;
export const ARROW_TYPE_VALUES = ["sharp", "round", "elbow"] as const;
export const TEXT_ALIGN_VALUES = ["left", "center", "right"] as const;
/** "none" = no arrowhead (TOML has no null). */
export const ARROWHEAD_VALUES = [
  "none",
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
] as const;
/** Every id in Excalidraw's FONT_FAMILY (same list as [editor] font_family). */
export const FONT_FAMILY_IDS = [1, 2, 3, 5, 6, 7, 8, 9, 10] as const;

export const STROKE_WIDTH_LIMITS = { min: 0.5, max: 40 } as const;
export const FONT_SIZE_LIMITS = { min: 4, max: 400 } as const;
export const OPACITY_LIMITS = { min: 1, max: 100 } as const;

export interface ToolStyle {
  stroke_color?: string;
  background_color?: string;
  fill_style?: typeof FILL_STYLE_VALUES[number];
  /** Stroke width in px; any value in STROKE_WIDTH_LIMITS (e.g. 3). */
  stroke_width?: number;
  stroke_style?: typeof STROKE_STYLE_VALUES[number];
  /** 0 architect, 1 artist, 2 cartoonist. */
  roughness?: 0 | 1 | 2;
  roundness?: typeof ROUNDNESS_VALUES[number];
  opacity?: number;
  arrow_type?: typeof ARROW_TYPE_VALUES[number];
  start_arrowhead?: typeof ARROWHEAD_VALUES[number];
  end_arrowhead?: typeof ARROWHEAD_VALUES[number];
  font_family?: typeof FONT_FAMILY_IDS[number];
  font_size?: number;
  text_align?: typeof TEXT_ALIGN_VALUES[number];
}
export type ToolStyleKey = keyof ToolStyle;

/** Saved defaults of every tool; a tool without an entry (or {}) has none. */
export type ToolDefaults = Partial<Record<StyledTool, ToolStyle>>;

const SHAPE_KEYS: readonly ToolStyleKey[] = [
  "stroke_color",
  "background_color",
  "fill_style",
  "stroke_width",
  "stroke_style",
  "roughness",
  "opacity",
];

/** The keys each tool understands, in display (and config) order. */
export const TOOL_STYLE_KEYS: Record<StyledTool, readonly ToolStyleKey[]> = {
  rectangle: [...SHAPE_KEYS, "roundness"],
  diamond: [...SHAPE_KEYS, "roundness"],
  ellipse: SHAPE_KEYS,
  arrow: [
    "stroke_color",
    "stroke_width",
    "stroke_style",
    "roughness",
    "opacity",
    "arrow_type",
    "start_arrowhead",
    "end_arrowhead",
  ],
  line: [...SHAPE_KEYS, "roundness"],
  text: ["stroke_color", "opacity", "font_family", "font_size", "text_align"],
};

export const STYLE_KEY_LABELS: Record<ToolStyleKey, string> = {
  stroke_color: "Stroke colour",
  background_color: "Background",
  fill_style: "Fill",
  stroke_width: "Stroke width",
  stroke_style: "Stroke style",
  roughness: "Sloppiness",
  roundness: "Edges",
  opacity: "Opacity",
  arrow_type: "Arrow type",
  start_arrowhead: "Start arrowhead",
  end_arrowhead: "End arrowhead",
  font_family: "Font",
  font_size: "Font size",
  text_align: "Text align",
};

const COLOR_RE =
  /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|[a-z]+)$/i;

const isNumberIn = (v: unknown, { min, max }: { min: number; max: number }) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

const oneOf = (values: readonly unknown[]) => (v: unknown) =>
  values.includes(v);

const list = (values: readonly unknown[]) =>
  values.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ");

/** Per key: the check and the human description used in problem messages. */
export const STYLE_KEY_RULES: Record<
  ToolStyleKey,
  { valid: (v: unknown) => boolean; expected: string }
> = {
  stroke_color: {
    valid: (v) => typeof v === "string" && COLOR_RE.test(v),
    expected: 'a colour like "#f08c00"',
  },
  background_color: {
    valid: (v) => typeof v === "string" && COLOR_RE.test(v),
    expected: 'a colour like "transparent" or "#ffec99"',
  },
  fill_style: {
    valid: oneOf(FILL_STYLE_VALUES),
    expected: list(FILL_STYLE_VALUES),
  },
  stroke_width: {
    valid: (v) => isNumberIn(v, STROKE_WIDTH_LIMITS),
    expected: `a number between ${STROKE_WIDTH_LIMITS.min} and ${STROKE_WIDTH_LIMITS.max} (px)`,
  },
  stroke_style: {
    valid: oneOf(STROKE_STYLE_VALUES),
    expected: list(STROKE_STYLE_VALUES),
  },
  roughness: { valid: oneOf([0, 1, 2]), expected: "0, 1 or 2" },
  roundness: {
    valid: oneOf(ROUNDNESS_VALUES),
    expected: list(ROUNDNESS_VALUES),
  },
  opacity: {
    valid: (v) => isNumberIn(v, OPACITY_LIMITS),
    expected: `a number between ${OPACITY_LIMITS.min} and ${OPACITY_LIMITS.max}`,
  },
  arrow_type: {
    valid: oneOf(ARROW_TYPE_VALUES),
    expected: list(ARROW_TYPE_VALUES),
  },
  start_arrowhead: {
    valid: oneOf(ARROWHEAD_VALUES),
    expected: `an arrowhead (${list(ARROWHEAD_VALUES)})`,
  },
  end_arrowhead: {
    valid: oneOf(ARROWHEAD_VALUES),
    expected: `an arrowhead (${list(ARROWHEAD_VALUES)})`,
  },
  font_family: {
    valid: oneOf(FONT_FAMILY_IDS),
    expected: `one of ${list(FONT_FAMILY_IDS)}`,
  },
  font_size: {
    valid: (v) => isNumberIn(v, FONT_SIZE_LIMITS),
    expected: `a number between ${FONT_SIZE_LIMITS.min} and ${FONT_SIZE_LIMITS.max}`,
  },
  text_align: {
    valid: oneOf(TEXT_ALIGN_VALUES),
    expected: list(TEXT_ALIGN_VALUES),
  },
};

/**
 * Why `value` is not a usable style for `tool`, or null when it is. An empty
 * table is valid (= no defaults). Unknown keys are rejected so typos surface.
 */
export function toolStyleProblem(
  tool: StyledTool,
  value: unknown,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "is not a table";
  }
  const allowed = TOOL_STYLE_KEYS[tool];
  for (const [key, v] of Object.entries(value)) {
    if (!(allowed as readonly string[]).includes(key)) {
      return `has an unknown key ${key} (allowed: ${allowed.join(", ")})`;
    }
    const rule = STYLE_KEY_RULES[key as ToolStyleKey];
    if (!rule.valid(v)) {
      return `${key} = ${JSON.stringify(v)} is not valid (expected ${
        rule.expected
      })`;
    }
  }
  return null;
}

export const isToolStyle = (tool: StyledTool, value: unknown) =>
  toolStyleProblem(tool, value) === null;

/** The style's keys in TOOL_STYLE_KEYS order (stable config output). */
export function orderedStyle(tool: StyledTool, style: ToolStyle): ToolStyle {
  const out: Record<string, unknown> = {};
  for (const key of TOOL_STYLE_KEYS[tool]) {
    if (style[key] !== undefined) {
      out[key] = style[key];
    }
  }
  return out as ToolStyle;
}

export const isEmptyStyle = (style: ToolStyle | undefined | null) =>
  !style || Object.keys(style).length === 0;

/** The preferences field holding a tool's style ("toolArrow"). */
export type ToolField = `tool${Capitalize<StyledTool>}`;
export const toolField = (tool: StyledTool): ToolField =>
  `tool${tool[0].toUpperCase()}${tool.slice(1)}` as ToolField;
export const TOOL_FIELDS: readonly ToolField[] =
  TOOL_DEFAULT_TOOLS.map(toolField);
/** config.toml / settings.toml key of a tool's table ("tools.arrow"). */
export const toolConfigKey = (tool: StyledTool) => `tools.${tool}`;
