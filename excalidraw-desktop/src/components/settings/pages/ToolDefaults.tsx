import { useEffect, useState } from "react";

import {
  ARROWHEAD_VALUES,
  ARROW_TYPE_VALUES,
  FILL_STYLE_VALUES,
  FONT_SIZE_LIMITS,
  OPACITY_LIMITS,
  ROUNDNESS_VALUES,
  STROKE_STYLE_VALUES,
  STROKE_WIDTH_LIMITS,
  STYLE_KEY_LABELS,
  TEXT_ALIGN_VALUES,
  TOOL_DEFAULT_TOOLS,
  TOOL_LABELS,
  TOOL_STYLE_KEYS,
  toolField,
  type StyledTool,
  type ToolStyle,
  type ToolStyleKey,
} from "../../../toolDefaults/toolStyles";
import { defaultFontLabel } from "../../../toolDefaults/fontName";
import { useSettings, type SettingControls } from "../SettingsContext";

import { BG_COLORS, FONT_OPTIONS, STROKE_COLORS } from "./Drawing";
import { ColorSwatches } from "./controls";
import { useCanvasTheme } from "./useCanvasTheme";
import { ScopeBadge, ScopeErrors, useScopeAttrs } from "./scopedRow";
import { ToolStylePreview, type PreviewFallback } from "./ToolPreview";
import {
  ResetButton,
  ToolsPanel,
  ToolsPanelHeader,
  ToolsRow,
} from "./toolsLayout";

const ROUGHNESS_LABELS = ["Architect", "Artist", "Cartoonist"];

type Choice = { value: string; label: string };

const humanise = (v: string) => {
  const text = v.replace(/_/g, " ").replace(/-/g, " ");
  return text[0].toUpperCase() + text.slice(1);
};
const choices = (values: readonly string[]): Choice[] =>
  values.map((value) => ({ value, label: humanise(value) }));

/** Enum-like keys: the options after the leading "Default" (unset). */
const SELECT_OPTIONS: Partial<Record<ToolStyleKey, Choice[]>> = {
  fill_style: choices(FILL_STYLE_VALUES),
  stroke_style: choices(STROKE_STYLE_VALUES),
  roughness: ROUGHNESS_LABELS.map((label, i) => ({ value: String(i), label })),
  roundness: choices(ROUNDNESS_VALUES),
  arrow_type: choices(ARROW_TYPE_VALUES),
  start_arrowhead: choices(ARROWHEAD_VALUES),
  end_arrowhead: choices(ARROWHEAD_VALUES),
  font_family: FONT_OPTIONS.map((f) => ({
    value: String(f.id),
    label: f.label.replace(/ \(.*\)$/, ""),
  })),
  text_align: choices(TEXT_ALIGN_VALUES),
};

const NUMBER_LIMITS: Partial<
  Record<ToolStyleKey, { min: number; max: number; step: number }>
> = {
  stroke_width: { ...STROKE_WIDTH_LIMITS, step: 0.5 },
  opacity: { ...OPACITY_LIMITS, step: 1 },
  font_size: { ...FONT_SIZE_LIMITS, step: 1 },
};

const NUMBER_HINTS: Partial<Record<ToolStyleKey, string>> = {
  stroke_width: "px",
  opacity: "%",
  font_size: "px",
  font_family:
    "[editor] defaults only seed new drawings; existing drawings keep their own fonts.",
};

const COLOR_PRESETS: Partial<Record<ToolStyleKey, readonly string[]>> = {
  stroke_color: STROKE_COLORS,
  background_color: BG_COLORS,
};

const hexOr = (value: string | undefined, fallback: string) =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

type SetKey = (key: ToolStyleKey, value: string | number | undefined) => void;

const ColorControl = ({
  testId,
  label,
  presets,
  value,
  onChange,
}: {
  testId: string;
  label: string;
  presets: readonly string[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) => {
  const canvasTheme = useCanvasTheme();
  return (
    <div className="vault-tools-colour">
      <ColorSwatches
        canvasTheme={canvasTheme}
        colors={presets}
        value={value ?? ""}
        onChange={onChange}
        onClear={() => onChange(undefined)}
        swatchLabel={(c) => `${label} ${c}`}
        customValue={hexOr(
          value,
          presets[0] === "transparent" ? "#ffffff" : "#1e1e1e",
        )}
        customTitle={`Custom ${label.toLowerCase()}`}
        inputTestId={testId}
      />
    </div>
  );
};

/** Number field: empty = Default (unset); out of range clamps, junk reverts. */
const NumberControl = ({
  testId,
  label,
  limits,
  value,
  integer,
  onChange,
}: {
  testId: string;
  label: string;
  limits: { min: number; max: number; step: number };
  value: number | undefined;
  integer: boolean;
  onChange: (value: number | undefined) => void;
}) => {
  const shown = value === undefined ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (text.trim() === "") {
      setText("");
      onChange(undefined);
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(shown);
      return;
    }
    const clamped = Math.min(limits.max, Math.max(limits.min, n));
    onChange(integer ? Math.round(clamped) : clamped);
  };
  return (
    <input
      type="number"
      className="vault-input vault-input--number"
      data-testid={testId}
      aria-label={label}
      placeholder="Default"
      min={limits.min}
      max={limits.max}
      step={limits.step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
        }
      }}
    />
  );
};

const SelectControl = ({
  testId,
  label,
  options,
  value,
  defaultLabel = "Default",
  onChange,
}: {
  testId: string;
  label: string;
  options: Choice[];
  defaultLabel?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) => (
  <select
    className="vault-input"
    data-testid={testId}
    aria-label={label}
    value={value ?? ""}
    onChange={(e) =>
      onChange(e.target.value === "" ? undefined : e.target.value)
    }
  >
    <option value="">{defaultLabel}</option>
    {value !== undefined && !options.some((o) => o.value === value) && (
      <option value={value}>{value}: Other</option>
    )}
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

const StyleField = ({
  tool,
  styleKey,
  style,
  setKey,
  defaultFont,
}: {
  tool: StyledTool;
  styleKey: ToolStyleKey;
  style: ToolStyle;
  setKey: SetKey;
  defaultFont: number;
}) => {
  const testId = `tool-default-${tool}-${styleKey}`;
  const title = STYLE_KEY_LABELS[styleKey];
  const label = `${TOOL_LABELS[tool]} ${title.toLowerCase()}`;
  const raw = style[styleKey];
  const presets = COLOR_PRESETS[styleKey];
  const limits = NUMBER_LIMITS[styleKey];
  const options = SELECT_OPTIONS[styleKey];
  let control = null;
  if (presets) {
    control = (
      <ColorControl
        testId={testId}
        label={label}
        presets={presets}
        value={raw as string | undefined}
        onChange={(v) => setKey(styleKey, v)}
      />
    );
  } else if (limits) {
    control = (
      <NumberControl
        testId={testId}
        label={label}
        limits={limits}
        integer={styleKey !== "stroke_width"}
        value={raw as number | undefined}
        onChange={(v) => setKey(styleKey, v)}
      />
    );
  } else if (options) {
    const numeric = styleKey === "roughness" || styleKey === "font_family";
    control = (
      <SelectControl
        testId={testId}
        label={label}
        options={options}
        defaultLabel={
          styleKey === "font_family" ? defaultFontLabel(defaultFont) : undefined
        }
        value={raw === undefined ? undefined : String(raw)}
        onChange={(v) =>
          setKey(styleKey, v === undefined || !numeric ? v : Number(v))
        }
      />
    );
  }
  return (
    <ToolsRow label={title} hint={NUMBER_HINTS[styleKey]}>
      {control}
    </ToolsRow>
  );
};

/** Editor defaults ("Default" in every row) for the preview. */
const usePreviewFallback = (): PreviewFallback => {
  const { defaults } = useSettings();
  return {
    strokeColor: defaults.defaultStrokeColor,
    backgroundColor: defaults.defaultBackgroundColor,
    fillStyle: defaults.defaultFillStyle,
    strokeWidth: defaults.defaultStrokeWidth,
    roughness: defaults.defaultRoughness,
    fontFamily: defaults.defaultFontFamily,
    fontSize: defaults.defaultFontSize,
  };
};

/** A styled tool's default style (empty = the tool has no default). */
export const useToolStyle = (tool: StyledTool): ToolStyle => {
  const { scopedValue } = useSettings();
  return scopedValue(toolField(tool));
};

/**
 * One tool's section: header (name, scope badge, Reset), a live preview and
 * a row per style key. Edits go to the current scope (global or this vault).
 */
export const ToolStylePanel = ({ tool }: { tool: StyledTool }) => {
  const { setScopedValue } = useSettings();
  const field = toolField(tool);
  const style = useToolStyle(tool);
  const fallback = usePreviewFallback();
  const theme = useCanvasTheme();
  const scopeAttrs = useScopeAttrs(field);
  const setKey: SetKey = (key, value) => {
    const next: Record<string, unknown> = { ...style };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    setScopedValue(field, next as ToolStyle);
  };
  return (
    <ToolsPanel
      section={tool}
      settingId={`tool-${tool}`}
      testId={`tool-default-${tool}`}
      data={scopeAttrs}
    >
      <ToolsPanelHeader section={tool}>
        <ScopeBadge
          field={field}
          resetLabel={`Reset ${TOOL_LABELS[tool]} to global`}
        />
        <ResetButton
          label={`Reset ${TOOL_LABELS[tool]}`}
          title="Remove this tool's default style"
          disabled={Object.keys(style).length === 0}
          onClick={() => setScopedValue(field, {})}
        />
      </ToolsPanelHeader>
      <ScopeErrors />
      <ToolStylePreview
        tool={tool}
        style={style}
        fallback={fallback}
        theme={theme}
      />
      <div className="vault-tools-rows">
        {TOOL_STYLE_KEYS[tool].map((key) => (
          <StyleField
            key={key}
            tool={tool}
            styleKey={key}
            style={style}
            setKey={setKey}
            defaultFont={fallback.fontFamily}
          />
        ))}
      </div>
    </ToolsPanel>
  );
};

/** Search results show the whole tool section. */
export const toolDefaultsControls: SettingControls = Object.fromEntries(
  TOOL_DEFAULT_TOOLS.map((tool) => [
    `tool-${tool}`,
    { Component: () => <ToolStylePanel tool={tool} /> },
  ]),
);
