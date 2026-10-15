import { useEffect, useState } from "react";

import { LASER_LIMITS } from "../../../pens/laserSettings";
import {
  DEFAULT_PEN_PRESETS,
  MAX_PEN_PRESETS,
  MAX_PEN_WIDTH,
  MIN_PEN_WIDTH,
  type PenPreset,
} from "../../../pens/penPresets";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  subscribePreferences,
  updatePreferences,
  type VaultPreferences,
} from "../../../vault/preferences";
import { IconPlus } from "../../Icons";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { ColorSwatches, Switch } from "./controls";
import { LaserPreview, PenPreview } from "./ToolPreview";
import {
  ResetButton,
  ToolsPanel,
  ToolsPanelHeader,
  ToolsRow,
} from "./toolsLayout";

const PEN_COLORS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#ffd43b"];
const LASER_COLORS = ["red", "#f08c00", "#2f9e44", "#1971c2", "#9c36b5"];

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Preferences, kept in step with every change (also from config reloads). */
const usePrefs = (): VaultPreferences => {
  const { win } = useSettings();
  const [prefs, setPrefs] = useState(() => getPreferences(win));
  useEffect(
    () => subscribePreferences(() => setPrefs(getPreferences(win))),
    [win],
  );
  return prefs;
};

const hexOr = (value: string, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

/**
 * Number field that commits on blur or Enter. Out-of-range input is clamped,
 * unparsable input reverts; an invalid value is never passed on.
 */
const NumberField = ({
  value,
  min,
  max,
  step,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onCommit: (next: number) => void;
}) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  };
  return (
    <input
      type="number"
      className="vault-input vault-input--number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
};

const PEN_DEFAULTS = DEFAULT_PREFERENCES.penPresets;
const LASER_FIELDS = [
  "laserColor",
  "laserSize",
  "laserDecayMs",
  "laserLength",
] as const;

/** True when the pens differ from the built-in set (tab dot). */
export const usePensCustomised = () => {
  const pens = usePrefs().penPresets;
  return (
    pens.length !== PEN_DEFAULTS.length ||
    pens.some((pen, i) =>
      (Object.keys(pen) as (keyof PenPreset)[]).some(
        (k) => pen[k] !== PEN_DEFAULTS[i][k],
      ),
    )
  );
};

/** True when any laser value differs from its default (tab dot). */
export const useLaserCustomised = () => {
  const prefs = usePrefs();
  return LASER_FIELDS.some((f) => prefs[f] !== DEFAULT_PREFERENCES[f]);
};

/** The selected pen's settings, one row each. */
const PenRows = ({
  pen,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  pen: PenPreset;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<PenPreset>) => void;
  onRemove: () => void;
}) => {
  const n = index + 1;
  const [name, setName] = useState(pen.name);
  useEffect(() => setName(pen.name), [pen.name]);
  return (
    <div className="vault-tools-rows" data-testid={`pen-row-${n}`}>
      <ToolsRow label="Name">
        <input
          className="vault-input vault-tools-text"
          aria-label={`Pen ${n} name`}
          maxLength={40}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) {
              onChange({ name: e.target.value });
            }
          }}
          onBlur={() => setName(pen.name)}
        />
      </ToolsRow>
      <ToolsRow label="Colour">
        <ColorSwatches
          colors={PEN_COLORS}
          value={pen.color}
          onChange={(color) => onChange({ color })}
          swatchLabel={(c) => `Pen ${n} colour ${c}`}
          customValue={hexOr(pen.color, "#1e1e1e")}
          customTitle={`Custom colour for pen ${n}`}
        />
      </ToolsRow>
      <ToolsRow label="Width" hint="px">
        <NumberField
          label={`Pen ${n} width`}
          value={pen.width}
          min={MIN_PEN_WIDTH}
          max={MAX_PEN_WIDTH}
          step={0.25}
          onCommit={(width) => onChange({ width })}
        />
      </ToolsRow>
      <ToolsRow label="Opacity" hint="%">
        <NumberField
          label={`Pen ${n} opacity`}
          value={pen.opacity}
          min={1}
          max={100}
          step={1}
          onCommit={(opacity) => onChange({ opacity: Math.round(opacity) })}
        />
      </ToolsRow>
      <ToolsRow label="Pressure" hint="variable width">
        <Switch
          checked={pen.pressure}
          label={`Pen ${n} pressure`}
          onChange={(pressure) => onChange({ pressure })}
        />
      </ToolsRow>
      <ToolsRow label="Smoothing">
        <input
          type="range"
          className="vault-range"
          min={0}
          max={1}
          step={0.05}
          value={pen.smoothing}
          aria-label={`Pen ${n} smoothing`}
          onChange={(e) =>
            onChange({ smoothing: clamp(Number(e.target.value), 0, 1) })
          }
        />
      </ToolsRow>
      <ToolsRow label="Highlighter" hint="behind other strokes">
        <Switch
          checked={pen.highlighter}
          label={`Pen ${n} highlighter`}
          onChange={(highlighter) => onChange({ highlighter })}
        />
      </ToolsRow>
      <ToolsRow label="Remove this pen">
        <button
          type="button"
          className="vault-btn vault-btn--sm vault-tools-danger"
          disabled={!canRemove}
          aria-label={`Remove pen ${n}`}
          onClick={onRemove}
        >
          Remove pen
        </button>
      </ToolsRow>
    </div>
  );
};

/** Pen chips: pick which saved pen the rows below edit. */
const PenPicker = ({
  pens,
  selected,
  onSelect,
}: {
  pens: readonly PenPreset[];
  selected: number;
  onSelect: (index: number) => void;
}) => (
  <div className="vault-tools-pens" role="radiogroup" aria-label="Pens">
    {pens.map((pen, i) => (
      <button
        // Position is the identity: presets are selected by Alt+number.
        // eslint-disable-next-line react/no-array-index-key
        key={i}
        type="button"
        role="radio"
        aria-checked={i === selected}
        className={`vault-tools-pen ${
          i === selected ? "vault-tools-pen--active" : ""
        }`}
        title={`${pen.name} (Alt+${i + 1})`}
        onClick={() => onSelect(i)}
      >
        <span
          className="vault-tools-pen__dot"
          style={{ background: pen.color, opacity: pen.opacity / 100 }}
          aria-hidden="true"
        />
        <span className="vault-tools-pen__name">{pen.name}</span>
      </button>
    ))}
  </div>
);

/** The pen section: pick a pen, preview it and edit it; add or reset pens. */
export const PenPanel = () => {
  const { win } = useSettings();
  const { penPresets } = usePrefs();
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, penPresets.length - 1);
  const pen = penPresets[index];
  const save = (next: PenPreset[]) =>
    updatePreferences({ penPresets: next }, win);
  const edit = (i: number, patch: Partial<PenPreset>) =>
    save(penPresets.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <ToolsPanel section="pen" settingId="pen-presets" testId="tools-pen">
      <ToolsPanelHeader section="pen">
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--sm"
          disabled={penPresets.length >= MAX_PEN_PRESETS}
          onClick={() => {
            save([
              ...penPresets,
              {
                ...DEFAULT_PEN_PRESETS[1],
                name: `Pen ${penPresets.length + 1}`,
              },
            ]);
            setSelected(penPresets.length);
          }}
        >
          <IconPlus width="12" height="12" aria-hidden="true" />
          Add pen
        </button>
        <ResetButton
          label="Reset to defaults"
          title="Restore the built-in pens"
          onClick={() => save(PEN_DEFAULTS.map((p) => ({ ...p })))}
        />
      </ToolsPanelHeader>
      <PenPicker pens={penPresets} selected={index} onSelect={setSelected} />
      <PenPreview
        color={pen.color}
        width={pen.width}
        opacity={pen.opacity}
        pressure={pen.pressure}
        highlighter={pen.highlighter}
      />
      <PenRows
        key={index}
        pen={pen}
        index={index}
        canRemove={penPresets.length > 1}
        onChange={(patch) => edit(index, patch)}
        onRemove={() => save(penPresets.filter((_, j) => j !== index))}
      />
    </ToolsPanel>
  );
};

const resetLaser = (win: Window | null) =>
  updatePreferences(
    Object.fromEntries(LASER_FIELDS.map((f) => [f, DEFAULT_PREFERENCES[f]])),
    win,
  );

const LaserColor = () => {
  const { win } = useSettings();
  const { laserColor } = usePrefs();
  return (
    <ColorSwatches
      colors={LASER_COLORS}
      value={laserColor}
      onChange={(color) => updatePreferences({ laserColor: color }, win)}
      swatchLabel={(c) => `Laser colour ${c}`}
      customValue={hexOr(laserColor, "#e03131")}
      customTitle="Custom laser colour"
    />
  );
};

type LaserNumberField = "laserSize" | "laserDecayMs" | "laserLength";

const LASER_NUMBERS: readonly {
  id: string;
  label: string;
  row: string;
  hint?: string;
  field: LaserNumberField;
  limits: { min: number; max: number };
  step: number;
}[] = [
  {
    id: "laser-size",
    label: "Laser size",
    row: "Size",
    hint: "px",
    field: "laserSize",
    limits: LASER_LIMITS.size,
    step: 1,
  },
  {
    id: "laser-fade",
    label: "Laser fade time",
    row: "Fade time",
    hint: "ms",
    field: "laserDecayMs",
    limits: LASER_LIMITS.decayMs,
    step: 100,
  },
  {
    id: "laser-length",
    label: "Laser tail length",
    row: "Tail length",
    hint: "points",
    field: "laserLength",
    limits: LASER_LIMITS.length,
    step: 5,
  },
];

const LaserNumber = ({ spec }: { spec: typeof LASER_NUMBERS[number] }) => {
  const { win } = useSettings();
  const value = usePrefs()[spec.field];
  return (
    <NumberField
      label={spec.label}
      value={value}
      min={spec.limits.min}
      max={spec.limits.max}
      step={spec.step}
      onCommit={(next) => updatePreferences({ [spec.field]: next }, win)}
    />
  );
};

/** The laser section: preview and one row per value. */
export const LaserPanel = () => {
  const { win } = useSettings();
  const prefs = usePrefs();
  const customised = useLaserCustomised();
  return (
    <ToolsPanel section="laser" settingId="laser-color" testId="tools-laser">
      <ToolsPanelHeader section="laser">
        <ResetButton
          label="Reset laser"
          title="Restore the default laser"
          disabled={!customised}
          onClick={() => resetLaser(win)}
        />
      </ToolsPanelHeader>
      <LaserPreview
        color={prefs.laserColor}
        size={prefs.laserSize}
        length={prefs.laserLength}
      />
      <div className="vault-tools-rows">
        <ToolsRow label="Colour">
          <LaserColor />
        </ToolsRow>
        {LASER_NUMBERS.map((spec) => (
          <ToolsRow key={spec.id} label={spec.row} hint={spec.hint}>
            <LaserNumber spec={spec} />
          </ToolsRow>
        ))}
      </div>
    </ToolsPanel>
  );
};

/** Search results: the pen section, and each laser value as its own row. */
export const pensControls: SettingControls = {
  "pen-presets": { Component: PenPanel },
  "laser-color": {
    Component: () => (
      <SettingRow id="laser-color">
        <LaserColor />
      </SettingRow>
    ),
  },
  ...Object.fromEntries(
    LASER_NUMBERS.map((spec) => [
      spec.id,
      {
        Component: () => (
          <SettingRow id={spec.id}>
            <LaserNumber spec={spec} />
          </SettingRow>
        ),
      },
    ]),
  ),
};
