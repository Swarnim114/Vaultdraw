import { useState } from "react";

import { resolveAccent } from "../../../theme/accent";
import { openThemesDir } from "../../../theme/registry";
import { resolveTheme } from "../../../vault/preferences";
import { IconFolder } from "../../Icons";
import { ThemePicker } from "../../ThemePicker";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { ColorSwatches, Segmented, Switch } from "./controls";
import { PaperSetting } from "./PaperSetting";

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
      <Switch
        id="vault-sync-canvas"
        checked={syncCanvas}
        onChange={setSyncCanvas}
      />
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

const HEX_RE = /^#[0-9a-f]{6}$/i;

const AccentSetting = () => {
  const { win, mode, selection, accentColor, setAccentColor } = useSettings();
  const resolvedMode = resolveTheme(mode, win);
  const variant = selection.entry.theme[resolvedMode];
  const resolved = resolveAccent(variant, accentColor, resolvedMode);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? accentColor;
  const commitDraft = () => {
    const text = (draft ?? "").trim();
    setDraft(null);
    if (text === "") {
      setAccentColor("");
    } else if (HEX_RE.test(text)) {
      setAccentColor(text.toLowerCase());
    }
  };
  return (
    <SettingRow
      id="accent-colour"
      testId="settings-accent"
      onReset={accentColor ? () => setAccentColor("") : undefined}
      details={
        accentColor && resolved.adjusted ? (
          <div className="vault-setting-note" role="status">
            Adjusted for contrast: {resolved.primary}
          </div>
        ) : undefined
      }
    >
      <div className="vault-setting-inline">
        <input
          type="color"
          className="vault-color-input"
          aria-label="Accent colour picker"
          value={resolved.primary}
          onChange={(e) => setAccentColor(e.target.value)}
        />
        <input
          type="text"
          className="vault-input vault-input--compact"
          aria-label="Accent colour hex"
          placeholder="Theme default"
          spellCheck={false}
          value={shown}
          aria-invalid={
            draft !== null && draft !== "" && !HEX_RE.test(draft.trim())
          }
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitDraft();
            }
          }}
        />
      </div>
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
  "accent-colour": { Component: AccentSetting },
  "canvas-background": { Component: CanvasBackgroundSetting },
  paper: { Component: PaperSetting },
  "themes-folder": {
    Component: ThemesFolderSetting,
    available: (ctx) => ctx.registry.mode === "tauri",
  },
};
