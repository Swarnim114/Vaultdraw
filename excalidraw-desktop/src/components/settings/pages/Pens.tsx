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
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { ColorSwatches, Switch } from "./controls";

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

const PenRow = ({
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
    <div className="vault-pen-row" data-testid={`pen-row-${n}`}>
      <input
        className="vault-input"
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
      <ColorSwatches
        colors={PEN_COLORS}
        value={pen.color}
        onChange={(color) => onChange({ color })}
        swatchLabel={(c) => `Pen ${n} colour ${c}`}
        customValue={hexOr(pen.color, "#1e1e1e")}
        customTitle={`Custom colour for pen ${n}`}
      />
      <NumberField
        label={`Pen ${n} width`}
        value={pen.width}
        min={MIN_PEN_WIDTH}
        max={MAX_PEN_WIDTH}
        step={0.25}
        onCommit={(width) => onChange({ width })}
      />
      <NumberField
        label={`Pen ${n} opacity`}
        value={pen.opacity}
        min={1}
        max={100}
        step={1}
        onCommit={(opacity) => onChange({ opacity: Math.round(opacity) })}
      />
      <label className="vault-pen-toggle">
        Pressure (variable width)
        <Switch
          checked={pen.pressure}
          label={`Pen ${n} pressure`}
          onChange={(pressure) => onChange({ pressure })}
        />
      </label>
      <label className="vault-pen-toggle">
        Smoothing
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
      </label>
      <label className="vault-pen-toggle">
        Highlighter (behind other strokes)
        <Switch
          checked={pen.highlighter}
          label={`Pen ${n} highlighter`}
          onChange={(highlighter) => onChange({ highlighter })}
        />
      </label>
      <button
        type="button"
        className="vault-btn vault-btn--ghost"
        disabled={!canRemove}
        aria-label={`Remove pen ${n}`}
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
};

const PenPresetsSetting = () => {
  const { win } = useSettings();
  const { penPresets } = usePrefs();
  const save = (next: PenPreset[]) =>
    updatePreferences({ penPresets: next }, win);
  const edit = (index: number, patch: Partial<PenPreset>) =>
    save(penPresets.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  return (
    <SettingRow id="pen-presets" layout="block">
      <div className="vault-pen-list">
        {penPresets.map((pen, i) => (
          <PenRow
            // Position is the identity: presets are selected by Alt+number.
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            pen={pen}
            index={i}
            canRemove={penPresets.length > 1}
            onChange={(patch) => edit(i, patch)}
            onRemove={() => save(penPresets.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <div className="vault-setting-inline">
        <button
          type="button"
          className="vault-btn"
          disabled={penPresets.length >= MAX_PEN_PRESETS}
          onClick={() =>
            save([
              ...penPresets,
              {
                ...DEFAULT_PEN_PRESETS[1],
                name: `Pen ${penPresets.length + 1}`,
              },
            ])
          }
        >
          Add pen
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--ghost"
          onClick={() =>
            save(DEFAULT_PREFERENCES.penPresets.map((p) => ({ ...p })))
          }
        >
          Reset to defaults
        </button>
      </div>
    </SettingRow>
  );
};

const LaserColorSetting = () => {
  const { win } = useSettings();
  const { laserColor } = usePrefs();
  const resetAll = () =>
    updatePreferences(
      {
        laserColor: DEFAULT_PREFERENCES.laserColor,
        laserSize: DEFAULT_PREFERENCES.laserSize,
        laserDecayMs: DEFAULT_PREFERENCES.laserDecayMs,
        laserLength: DEFAULT_PREFERENCES.laserLength,
      },
      win,
    );
  return (
    <SettingRow id="laser-color">
      <ColorSwatches
        colors={LASER_COLORS}
        value={laserColor}
        onChange={(color) => updatePreferences({ laserColor: color }, win)}
        swatchLabel={(c) => `Laser colour ${c}`}
        customValue={hexOr(laserColor, "#e03131")}
        customTitle="Custom laser colour"
      />
      <button
        type="button"
        className="vault-btn vault-btn--ghost"
        onClick={resetAll}
      >
        Reset laser
      </button>
    </SettingRow>
  );
};

const laserNumber = (
  id: string,
  label: string,
  field: "laserSize" | "laserDecayMs" | "laserLength",
  limits: { min: number; max: number },
  step: number,
) => {
  const Control = () => {
    const { win } = useSettings();
    const value = usePrefs()[field];
    return (
      <SettingRow id={id}>
        <NumberField
          label={label}
          value={value}
          min={limits.min}
          max={limits.max}
          step={step}
          onCommit={(next) => updatePreferences({ [field]: next }, win)}
        />
      </SettingRow>
    );
  };
  return Control;
};

export const pensControls: SettingControls = {
  "pen-presets": { Component: PenPresetsSetting },
  "laser-color": { Component: LaserColorSetting },
  "laser-size": {
    Component: laserNumber(
      "laser-size",
      "Laser size",
      "laserSize",
      LASER_LIMITS.size,
      1,
    ),
  },
  "laser-fade": {
    Component: laserNumber(
      "laser-fade",
      "Laser fade time",
      "laserDecayMs",
      LASER_LIMITS.decayMs,
      100,
    ),
  },
  "laser-length": {
    Component: laserNumber(
      "laser-length",
      "Laser tail length",
      "laserLength",
      LASER_LIMITS.length,
      5,
    ),
  },
};
