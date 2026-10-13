import { useState } from "react";

import { openThemesDir } from "../../../theme/registry";
import { IconFolder } from "../../Icons";
import { ThemePicker } from "../../ThemePicker";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { ColorSwatches, Segmented } from "./controls";

import type { VaultTheme } from "../../../vault/preferences";

const MODES: readonly { key: VaultTheme; label: string }[] = [
  { key: "system", label: "Match System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

const CANVAS_BG_COLORS = [
  "#ffffff",
  "#f8f9fa",
  "#f1f3f5",
  "#1e1e24",
  "#121214",
  "#18191c",
];

const ModeSetting = () => {
  const { mode, setMode } = useSettings();
  return (
    <SettingRow id="mode">
      <Segmented
        options={MODES.map((m) => ({ label: m.label, val: m.key }))}
        value={mode}
        onChange={setMode}
      />
    </SettingRow>
  );
};

const ColourThemeSetting = () => {
  const { registry, selection, selectColourTheme } = useSettings();
  const userThemeProblems = registry.fileProblems;
  return (
    <SettingRow id="colour-theme" layout="block" testId="settings-theme">
      <ThemePicker
        themes={registry.themes}
        selectedKey={selection.entry.key}
        onSelect={selectColourTheme}
      />
      {selection.problem && (
        <div className="vault-theme-problem" role="status">
          {selection.problem}
        </div>
      )}
      {userThemeProblems.length > 0 && (
        <ul className="vault-theme-problems" aria-label="Theme file problems">
          {userThemeProblems.map((p) => (
            <li
              key={`${p.path}:${p.message}`}
              className={`vault-theme-problems__item vault-theme-problems__item--${p.kind}`}
              title={p.path}
            >
              {p.message}
            </li>
          ))}
        </ul>
      )}
      {registry.loadError && (
        <div className="vault-theme-problem" role="status">
          {registry.loadError}
        </div>
      )}
    </SettingRow>
  );
};

const SyncCanvasSetting = () => {
  const { syncCanvas, setSyncCanvas } = useSettings();
  return (
    <SettingRow id="sync-canvas" htmlFor="vault-sync-canvas">
      <label className="vault-switch">
        <input
          id="vault-sync-canvas"
          type="checkbox"
          role="switch"
          checked={syncCanvas}
          aria-checked={syncCanvas}
          onChange={(e) => setSyncCanvas(e.target.checked)}
        />
        <span className="vault-switch__track" aria-hidden="true">
          <span className="vault-switch__thumb" />
        </span>
      </label>
    </SettingRow>
  );
};

const CanvasBackgroundSetting = () => {
  const { syncCanvas, defaults, updateDefaults } = useSettings();
  const value = defaults.defaultCanvasBackground ?? "#ffffff";
  return (
    <SettingRow
      id="canvas-background"
      disabled={syncCanvas}
      testId="settings-canvas-background"
      description={
        syncCanvas
          ? "The canvas follows the theme while sync is on."
          : undefined
      }
    >
      <ColorSwatches
        colors={CANVAS_BG_COLORS}
        value={value}
        onChange={(color) => updateDefaults({ defaultCanvasBackground: color })}
        swatchLabel={(color) => `Canvas color ${color}`}
        customValue={value}
        customTitle="Custom canvas background color"
        disabled={syncCanvas}
      />
    </SettingRow>
  );
};

const ThemesFolderSetting = () => {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    try {
      await openThemesDir();
    } catch (err) {
      setError(
        `Could not open the themes folder: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };
  return (
    <SettingRow
      id="themes-folder"
      testId="themes-folder"
      details={
        error && (
          <div
            className="vault-config-status vault-config-status--error"
            role="status"
          >
            {error}
          </div>
        )
      }
    >
      <button
        type="button"
        className="vault-btn vault-btn--sm"
        onClick={() => void open()}
      >
        <IconFolder />
        <span>Open themes folder</span>
      </button>
    </SettingRow>
  );
};

export const appearanceControls: SettingControls = {
  mode: { Component: ModeSetting },
  "colour-theme": { Component: ColourThemeSetting },
  "sync-canvas": { Component: SyncCanvasSetting },
  "canvas-background": { Component: CanvasBackgroundSetting },
  "themes-folder": {
    Component: ThemesFolderSetting,
    available: (ctx) => ctx.registry.mode === "tauri",
  },
};
