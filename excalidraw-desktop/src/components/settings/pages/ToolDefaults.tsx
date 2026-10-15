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
import { useSettings, type SettingControls } from "../SettingsContext";

import { BG_COLORS, FONT_OPTIONS, STROKE_COLORS } from "./Drawing";
import { ColorSwatches } from "./controls";
import { PerVaultRow } from "./perVault";
import "./ToolDefaults.css";

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
}) => (
  <div className="vault-tooldef-colour">
    <ColorSwatches
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
  onChange,
}: {
  testId: string;
  label: string;
  options: Choice[];
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
    <option value="">Default</option>
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
}: {
  tool: StyledTool;
  styleKey: ToolStyleKey;
  style: ToolStyle;
  setKey: SetKey;
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
        value={raw === undefined ? undefined : String(raw)}
        onChange={(v) =>
          setKey(styleKey, v === undefined || !numeric ? v : Number(v))
        }
      />
    );
  }
  return (
    <div className="vault-tooldef-field">
      <span className="vault-tooldef-field__label">{title}</span>
      {control}
    </div>
  );
};

const ToolRow = ({ tool }: { tool: StyledTool }) => {
  const { setPerVaultValue } = useSettings();
  const field = toolField(tool);
  return (
    <PerVaultRow
      id={`tool-${tool}`}
      field={field}
      layout="block"
      testId={`tool-default-${tool}`}
    >
      {(style, onChange) => {
        const setKey: SetKey = (key, value) => {
          const next: Record<string, unknown> = { ...style };
          if (value === undefined) {
            delete next[key];
          } else {
            next[key] = value;
          }
          onChange(next as ToolStyle);
        };
        return (
          <div className="vault-tooldef">
            <div className="vault-tooldef-grid">
              {TOOL_STYLE_KEYS[tool].map((key) => (
                <StyleField
                  key={key}
                  tool={tool}
                  styleKey={key}
                  style={style}
                  setKey={setKey}
                />
              ))}
            </div>
            <button
              type="button"
              className="vault-btn vault-btn--ghost"
              aria-label={`Reset ${TOOL_LABELS[tool]}`}
              title="Remove this tool's default style"
              onClick={() => setPerVaultValue(field, {})}
            >
              Reset
            </button>
          </div>
        );
      }}
    </PerVaultRow>
  );
};

export const toolDefaultsControls: SettingControls = Object.fromEntries(
  TOOL_DEFAULT_TOOLS.map((tool) => [
    `tool-${tool}`,
    { Component: () => <ToolRow tool={tool} /> },
  ]),
);
