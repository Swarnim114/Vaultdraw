import { useEffect, useRef, useState } from "react";

import {
  getEditorDefaults,
  getPreferences,
  getTheme,
  resolveTheme,
  setAutosaveDelayMs,
  setEditorDefaults,
  setTheme,
  updatePreferences,
  type VaultTheme,
} from "../vault/preferences";
import {
  getSettingsStatus,
  openConfigDir,
  PREFERENCES_CHANGED_EVENT,
  reloadSettings,
  SETTINGS_STATUS_EVENT,
} from "../vault/settingsSync";

import {
  getThemeRegistry,
  openThemesDir,
  resolveSelectedTheme,
  type ThemeEntry,
  type ThemeRegistry,
} from "../theme/registry";

import { IconClose, IconDrawing, IconFolder, IconSettings } from "./Icons";
import { ThemePicker } from "./ThemePicker";

import type { VaultInfo } from "../vault/types";

export interface SettingsModalProps {
  vault: VaultInfo | null;
  onClose: () => void;
  onThemeChanged?: (resolvedTheme: "light" | "dark") => void;
  /** Colour theme, mode or canvas sync changed (re-apply the appearance). */
  onAppearanceChanged?: () => void;
  /** Built-in + user themes; defaults to the cached registry. */
  themeRegistry?: ThemeRegistry;
  onRevealVault?: (path: string) => void;
  ownerDocument?: Document | null;
}

type SettingsTab = "appearance" | "editor" | "vault" | "about";

// Excalidraw's real FONT_FAMILY ids (packages/common/src/constants.ts).
const FONT_OPTIONS = [
  { id: 5, label: "Excalifont (Hand-drawn)" },
  { id: 6, label: "Nunito (Clean / Normal)" },
  { id: 8, label: "Comic Shanns (Code / Monospace)" },
  { id: 1, label: "Virgil (Classic hand-drawn)" },
  { id: 2, label: "Helvetica (Classic normal)" },
  { id: 3, label: "Cascadia (Classic code)" },
] as const;

export const SettingsModal = ({
  vault,
  onClose,
  onThemeChanged,
  onAppearanceChanged,
  themeRegistry,
  onRevealVault,
  ownerDocument,
}: SettingsModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const doc = ownerDocument ?? modalRef.current?.ownerDocument ?? null;
  const win =
    doc?.defaultView ?? (typeof window !== "undefined" ? window : null);

  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  // Local states initialized from preferences
  const [currentTheme, setCurrentThemeState] = useState<VaultTheme>(() =>
    getTheme(win),
  );
  const [colorTheme, setColorThemeState] = useState(
    () => getPreferences(win).colorTheme,
  );
  const [syncCanvas, setSyncCanvasState] = useState(
    () => getPreferences(win).syncCanvas,
  );
  const [themesAction, setThemesAction] = useState<string | null>(null);
  const registry = themeRegistry ?? getThemeRegistry();
  const selection = resolveSelectedTheme(registry, colorTheme);
  const userThemeProblems = registry.fileProblems;
  const [defaults, setDefaultsState] = useState(() => getEditorDefaults(win));
  const [autosaveDelay, setAutosaveDelayState] = useState(
    () => getPreferences(win).autosaveDelayMs,
  );

  const [settingsStatus, setSettingsStatus] = useState(getSettingsStatus);
  const [configAction, setConfigAction] = useState<{
    message: string;
    type: "info" | "error";
  } | null>(null);

  // Refresh displayed values when config.toml is reloaded while open.
  useEffect(() => {
    if (!win) {
      return;
    }
    const handlePreferencesChanged = () => {
      const prefs = getPreferences(win);
      setCurrentThemeState(prefs.theme);
      setColorThemeState(prefs.colorTheme);
      setSyncCanvasState(prefs.syncCanvas);
      setDefaultsState(getEditorDefaults(win));
      setAutosaveDelayState(prefs.autosaveDelayMs);
    };
    const handleStatus = () => setSettingsStatus(getSettingsStatus());
    win.addEventListener(PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
    win.addEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    return () => {
      win.removeEventListener(
        PREFERENCES_CHANGED_EVENT,
        handlePreferencesChanged,
      );
      win.removeEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    };
  }, [win]);

  const handleOpenConfigDir = async () => {
    setConfigAction(null);
    try {
      await openConfigDir();
    } catch (err) {
      setConfigAction({
        message: `Could not open the config folder: ${
          err instanceof Error ? err.message : String(err)
        }`,
        type: "error",
      });
    }
  };

  const handleReloadConfig = async () => {
    setConfigAction(null);
    try {
      const changed = await reloadSettings();
      const status = getSettingsStatus();
      setSettingsStatus(status);
      setConfigAction(
        status.problems.length
          ? { message: status.problems[0].message, type: "error" }
          : {
              message: changed
                ? "Reloaded config.toml."
                : "config.toml is up to date.",
              type: "info",
            },
      );
    } catch (err) {
      setConfigAction({
        message: `Could not reload: ${
          err instanceof Error ? err.message : String(err)
        }`,
        type: "error",
      });
    }
  };

  // Close on Escape key
  useEffect(() => {
    const targetDoc =
      doc ?? (typeof document !== "undefined" ? document : null);
    if (!targetDoc) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    targetDoc.addEventListener("keydown", handleKeyDown);
    return () => targetDoc.removeEventListener("keydown", handleKeyDown);
  }, [doc, onClose]);

  const handleThemeChange = (newTheme: VaultTheme) => {
    setCurrentThemeState(newTheme);
    setTheme(newTheme, win);

    const resolved = resolveTheme(newTheme, win);
    const targetDoc =
      doc ?? (typeof document !== "undefined" ? document : null);
    if (targetDoc) {
      targetDoc.documentElement.classList.toggle("dark", resolved === "dark");
    }
    onThemeChanged?.(resolved);
    onAppearanceChanged?.();
  };

  const handleColorThemeChange = (entry: ThemeEntry) => {
    setColorThemeState(entry.key);
    updatePreferences({ colorTheme: entry.key }, win);
    onAppearanceChanged?.();
  };

  const handleSyncCanvasChange = (next: boolean) => {
    setSyncCanvasState(next);
    updatePreferences({ syncCanvas: next }, win);
    onAppearanceChanged?.();
  };

  const handleOpenThemesDir = async () => {
    setThemesAction(null);
    try {
      await openThemesDir();
    } catch (err) {
      setThemesAction(
        `Could not open the themes folder: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  const handleUpdateDefaults = (
    partial: Parameters<typeof setEditorDefaults>[0],
  ) => {
    setEditorDefaults(partial, win);
    setDefaultsState(getEditorDefaults(win));
  };

  const handleAutosaveChange = (val: number) => {
    setAutosaveDelayState(val);
    setAutosaveDelayMs(val, win);
  };

  const strokeColors = [
    "#1e1e1e",
    "#e03131",
    "#2f9e44",
    "#1971c2",
    "#f08c00",
    "#9c36b5",
    "#099268",
    "#ffffff",
  ];

  const bgColors = [
    "transparent",
    "#ffc9c9",
    "#b2f2bb",
    "#a5d8ff",
    "#ffec99",
    "#eebefa",
    "#c3fae8",
    "#ffffff",
  ];

  const canvasBgColors = [
    "#ffffff",
    "#f8f9fa",
    "#f1f3f5",
    "#1e1e24",
    "#121214",
    "#18191c",
  ];

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={modalRef} className="vault-settings-modal">
        {/* Left Sidebar (Obsidian style) */}
        <aside className="vault-settings-sidebar">
          <div className="vault-settings-sidebar__title">
            <IconSettings />
            <span>Settings</span>
          </div>
          <nav className="vault-settings-nav" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "appearance"}
              className={`vault-settings-nav-item ${
                activeTab === "appearance"
                  ? "vault-settings-nav-item--active"
                  : ""
              }`}
              onClick={() => setActiveTab("appearance")}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: "6px" }}
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
              <span>Appearance & Theme</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "editor"}
              className={`vault-settings-nav-item ${
                activeTab === "editor" ? "vault-settings-nav-item--active" : ""
              }`}
              onClick={() => setActiveTab("editor")}
            >
              <IconDrawing
                width="14"
                height="14"
                style={{ marginRight: "6px" }}
              />
              <span>Drawing Defaults</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "vault"}
              className={`vault-settings-nav-item ${
                activeTab === "vault" ? "vault-settings-nav-item--active" : ""
              }`}
              onClick={() => setActiveTab("vault")}
            >
              <IconFolder
                width="14"
                height="14"
                style={{ marginRight: "6px" }}
              />
              <span>Vault & Storage</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "about"}
              className={`vault-settings-nav-item ${
                activeTab === "about" ? "vault-settings-nav-item--active" : ""
              }`}
              onClick={() => setActiveTab("about")}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: "6px" }}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>About</span>
            </button>
          </nav>
        </aside>

        {/* Right Content Panel */}
        <section className="vault-settings-content">
          <div className="vault-settings-header">
            <h2 id="settings-title" className="vault-settings-title">
              {activeTab === "appearance" && "Appearance & Theme"}
              {activeTab === "editor" && "Editor Defaults"}
              {activeTab === "vault" && "Vault & Storage"}
              {activeTab === "about" && "About Excalidraw Vault"}
            </h2>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={onClose}
              aria-label="Close Settings"
            >
              <IconClose />
            </button>
          </div>

          <div className="vault-settings-body">
            {/* 1. APPEARANCE TAB */}
            {activeTab === "appearance" && (
              <div className="vault-settings-section">
                <div
                  className="vault-setting-block"
                  data-testid="settings-theme"
                >
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">Colour Theme</div>
                    <div className="vault-setting-desc">
                      Colours for the whole app. Every theme works in light and
                      dark mode.
                    </div>
                  </div>
                  <ThemePicker
                    themes={registry.themes}
                    selectedKey={selection.entry.key}
                    onSelect={handleColorThemeChange}
                  />
                  {selection.problem && (
                    <div className="vault-theme-problem" role="status">
                      {selection.problem}
                    </div>
                  )}
                  {userThemeProblems.length > 0 && (
                    <ul
                      className="vault-theme-problems"
                      aria-label="Theme file problems"
                    >
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
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">Mode</div>
                    <div className="vault-setting-desc">
                      Light, dark, or follow the system appearance.
                    </div>
                  </div>
                  <div className="vault-segmented-control">
                    {[
                      { key: "system", label: "Match System" },
                      { key: "light", label: "Light" },
                      { key: "dark", label: "Dark" },
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={`vault-segmented-btn ${
                          currentTheme === t.key
                            ? "vault-segmented-btn--active"
                            : ""
                        }`}
                        onClick={() => handleThemeChange(t.key as VaultTheme)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <label
                      className="vault-setting-label"
                      htmlFor="vault-sync-canvas"
                    >
                      Sync canvas with theme
                    </label>
                    <div className="vault-setting-desc">
                      Shows the canvas and palette colours in the theme&apos;s
                      colours. On screen only: files and exports keep standard
                      colours.
                    </div>
                  </div>
                  <label className="vault-switch">
                    <input
                      id="vault-sync-canvas"
                      type="checkbox"
                      role="switch"
                      checked={syncCanvas}
                      aria-checked={syncCanvas}
                      onChange={(e) => handleSyncCanvasChange(e.target.checked)}
                    />
                    <span className="vault-switch__track" aria-hidden="true">
                      <span className="vault-switch__thumb" />
                    </span>
                  </label>
                </div>

                <div
                  className={`vault-setting-row ${
                    syncCanvas ? "vault-setting-row--disabled" : ""
                  }`}
                  data-testid="settings-canvas-background"
                >
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Default Canvas Background
                    </div>
                    <div className="vault-setting-desc">
                      {syncCanvas
                        ? "The canvas follows the theme while sync is on."
                        : "Background color applied to newly created drawings."}
                    </div>
                  </div>
                  <fieldset
                    className="vault-color-options vault-fieldset"
                    disabled={syncCanvas}
                  >
                    {canvasBgColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`vault-color-swatch ${
                          (defaults.defaultCanvasBackground ?? "#ffffff") ===
                          color
                            ? "vault-color-swatch--active"
                            : ""
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() =>
                          handleUpdateDefaults({
                            defaultCanvasBackground: color,
                          })
                        }
                        title={color}
                        aria-label={`Canvas color ${color}`}
                      />
                    ))}
                    <input
                      type="color"
                      className="vault-color-input"
                      value={defaults.defaultCanvasBackground ?? "#ffffff"}
                      onChange={(e) =>
                        handleUpdateDefaults({
                          defaultCanvasBackground: e.target.value,
                        })
                      }
                      title="Custom canvas background color"
                    />
                  </fieldset>
                </div>

                {registry.mode === "tauri" && (
                  <div
                    className="vault-setting-row"
                    data-testid="themes-folder"
                  >
                    <div className="vault-setting-info">
                      <div className="vault-setting-label">Themes Folder</div>
                      <div className="vault-setting-desc">
                        Drop Noctalia palettes (.json) here; they appear above
                        automatically.
                      </div>
                      {themesAction && (
                        <div
                          className="vault-config-status vault-config-status--error"
                          role="status"
                        >
                          {themesAction}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="vault-btn vault-btn--sm"
                      onClick={() => void handleOpenThemesDir()}
                    >
                      <IconFolder />
                      <span>Open themes folder</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 2. EDITOR DEFAULTS TAB */}
            {activeTab === "editor" && (
              <div className="vault-settings-section">
                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Default Font Family
                    </div>
                    <div className="vault-setting-desc">
                      Font used when typing text in new drawings.
                    </div>
                  </div>
                  <select
                    className="vault-input"
                    value={defaults.defaultFontFamily}
                    onChange={(e) =>
                      handleUpdateDefaults({
                        defaultFontFamily: Number(e.target.value),
                      })
                    }
                    style={{ width: "220px" }}
                  >
                    {!FONT_OPTIONS.some(
                      (f) => f.id === defaults.defaultFontFamily,
                    ) && (
                      <option value={defaults.defaultFontFamily}>
                        {defaults.defaultFontFamily}: Other
                      </option>
                    )}
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.id}: {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">Default Font Size</div>
                    <div className="vault-setting-desc">
                      Initial text size for new text elements.
                    </div>
                  </div>
                  <div className="vault-segmented-control">
                    {[
                      { label: "16 (Small)", val: 16 },
                      { label: "20 (Medium)", val: 20 },
                      { label: "28 (Large)", val: 28 },
                      { label: "36 (Extra Large)", val: 36 },
                    ].map((sz) => (
                      <button
                        key={sz.val}
                        type="button"
                        className={`vault-segmented-btn ${
                          defaults.defaultFontSize === sz.val
                            ? "vault-segmented-btn--active"
                            : ""
                        }`}
                        onClick={() =>
                          handleUpdateDefaults({ defaultFontSize: sz.val })
                        }
                      >
                        {sz.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Default Stroke Color
                    </div>
                    <div className="vault-setting-desc">
                      Primary line and shape outline color.
                    </div>
                  </div>
                  <div className="vault-color-options">
                    {strokeColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`vault-color-swatch ${
                          defaults.defaultStrokeColor === color
                            ? "vault-color-swatch--active"
                            : ""
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() =>
                          handleUpdateDefaults({ defaultStrokeColor: color })
                        }
                        title={color}
                        aria-label={`Stroke color ${color}`}
                      />
                    ))}
                    <input
                      type="color"
                      className="vault-color-input"
                      value={
                        defaults.defaultStrokeColor.startsWith("#")
                          ? defaults.defaultStrokeColor
                          : "#1e1e1e"
                      }
                      onChange={(e) =>
                        handleUpdateDefaults({
                          defaultStrokeColor: e.target.value,
                        })
                      }
                      title="Custom stroke color"
                    />
                  </div>
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Default Background Fill
                    </div>
                    <div className="vault-setting-desc">
                      Shape interior fill color.
                    </div>
                  </div>
                  <div className="vault-color-options">
                    {bgColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`vault-color-swatch ${
                          color === "transparent"
                            ? "vault-color-swatch--transparent"
                            : ""
                        } ${
                          defaults.defaultBackgroundColor === color
                            ? "vault-color-swatch--active"
                            : ""
                        }`}
                        style={{
                          backgroundColor:
                            color === "transparent" ? "#ffffff" : color,
                        }}
                        onClick={() =>
                          handleUpdateDefaults({
                            defaultBackgroundColor: color,
                          })
                        }
                        title={color === "transparent" ? "Transparent" : color}
                        aria-label={`Fill color ${color}`}
                      >
                        {color === "transparent" && (
                          <span style={{ fontSize: "10px", color: "#888" }}>
                            ∅
                          </span>
                        )}
                      </button>
                    ))}
                    <input
                      type="color"
                      className="vault-color-input"
                      value={
                        defaults.defaultBackgroundColor.startsWith("#")
                          ? defaults.defaultBackgroundColor
                          : "#ffffff"
                      }
                      onChange={(e) =>
                        handleUpdateDefaults({
                          defaultBackgroundColor: e.target.value,
                        })
                      }
                      title="Custom background fill color"
                    />
                  </div>
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Default Fill Style
                    </div>
                    <div className="vault-setting-desc">
                      Shading and texture pattern for shape backgrounds.
                    </div>
                  </div>
                  <div className="vault-segmented-control">
                    {[
                      { label: "Solid", val: "solid" },
                      { label: "Hachure", val: "hachure" },
                      { label: "Cross-hatch", val: "cross-hatch" },
                    ].map((fs) => (
                      <button
                        key={fs.val}
                        type="button"
                        className={`vault-segmented-btn ${
                          defaults.defaultFillStyle === fs.val
                            ? "vault-segmented-btn--active"
                            : ""
                        }`}
                        onClick={() =>
                          handleUpdateDefaults({ defaultFillStyle: fs.val })
                        }
                      >
                        {fs.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Default Stroke Width
                    </div>
                    <div className="vault-setting-desc">
                      Line thickness for shapes, lines, and arrows.
                    </div>
                  </div>
                  <div className="vault-segmented-control">
                    {[
                      { label: "Thin (1px)", val: 1 },
                      { label: "Medium (2px)", val: 2 },
                      { label: "Bold (4px)", val: 4 },
                    ].map((w) => (
                      <button
                        key={w.val}
                        type="button"
                        className={`vault-segmented-btn ${
                          defaults.defaultStrokeWidth === w.val
                            ? "vault-segmented-btn--active"
                            : ""
                        }`}
                        onClick={() =>
                          handleUpdateDefaults({ defaultStrokeWidth: w.val })
                        }
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">Default Roughness</div>
                    <div className="vault-setting-desc">
                      Hand-drawn sketch intensity.
                    </div>
                  </div>
                  <div className="vault-segmented-control">
                    {[
                      { label: "0: Architect (Clean)", val: 0 },
                      { label: "1: Artist (Natural)", val: 1 },
                      { label: "2: Cartoonist (Rough)", val: 2 },
                    ].map((r) => (
                      <button
                        key={r.val}
                        type="button"
                        className={`vault-segmented-btn ${
                          defaults.defaultRoughness === r.val
                            ? "vault-segmented-btn--active"
                            : ""
                        }`}
                        onClick={() =>
                          handleUpdateDefaults({ defaultRoughness: r.val })
                        }
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 3. VAULT & STORAGE TAB */}
            {activeTab === "vault" && (
              <div className="vault-settings-section">
                {settingsStatus.mode === "tauri" && (
                  <div
                    className="vault-setting-row vault-config-row"
                    data-testid="settings-config-row"
                  >
                    <div className="vault-setting-info">
                      <div className="vault-setting-label">Config File</div>
                      <div className="vault-setting-desc">
                        Settings live in a plain text file you can edit by hand;
                        changes apply live.
                      </div>
                      <code className="vault-config-path">
                        {settingsStatus.configPath ?? "Unknown location"}
                      </code>
                      {configAction && (
                        <div
                          className={`vault-config-status vault-config-status--${configAction.type}`}
                          role="status"
                        >
                          {configAction.message}
                        </div>
                      )}
                    </div>
                    <div className="vault-config-actions">
                      <button
                        type="button"
                        className="vault-btn vault-btn--sm"
                        onClick={() => void handleOpenConfigDir()}
                      >
                        <IconFolder />
                        <span>Open config folder</span>
                      </button>
                      <button
                        type="button"
                        className="vault-btn vault-btn--sm"
                        onClick={() => void handleReloadConfig()}
                      >
                        <span>Reload</span>
                      </button>
                    </div>
                  </div>
                )}
                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Current Vault Folder
                    </div>
                    <div
                      className="vault-setting-desc"
                      style={{ wordBreak: "break-all" }}
                    >
                      {vault?.path ?? "No vault currently open"}
                    </div>
                  </div>
                  {vault && onRevealVault && (
                    <button
                      type="button"
                      className="vault-btn vault-btn--sm"
                      onClick={() => onRevealVault("")}
                    >
                      <IconFolder />
                      <span>Reveal Folder</span>
                    </button>
                  )}
                </div>

                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      Autosave Debounce Interval
                    </div>
                    <div className="vault-setting-desc">
                      Time to wait after last drawing edit before writing
                      atomically to disk ({autosaveDelay}ms).
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <input
                      type="range"
                      min="200"
                      max="2000"
                      step="50"
                      value={autosaveDelay}
                      onChange={(e) =>
                        handleAutosaveChange(Number(e.target.value))
                      }
                      style={{ width: "130px" }}
                    />
                    <select
                      className="vault-input"
                      value={autosaveDelay}
                      onChange={(e) =>
                        handleAutosaveChange(Number(e.target.value))
                      }
                      style={{ width: "110px" }}
                    >
                      <option value={250}>250 ms</option>
                      <option value={500}>500 ms</option>
                      <option value={1000}>1000 ms</option>
                      <option value={2000}>2000 ms</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* 4. ABOUT TAB */}
            {activeTab === "about" && (
              <div className="vault-settings-section">
                <div style={{ textAlign: "center", padding: "16px 0 10px" }}>
                  <IconDrawing width="44" height="44" />
                  <h3 style={{ margin: "10px 0 4px", fontSize: "1.1rem" }}>
                    Excalidraw Vault
                  </h3>
                  <div
                    style={{
                      color: "var(--vault-text-muted)",
                      fontSize: "0.85rem",
                    }}
                  >
                    Version 0.1.0 • Offline Private Local Vault
                  </div>
                </div>
                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">
                      100% Offline & Private Local Vault
                    </div>
                    <div className="vault-setting-desc">
                      Your vault is an ordinary folder stored on your local hard
                      drive. Drawings are standard .excalidraw JSON files with
                      atomic writes, crash recovery store, and complete offline
                      privacy. Zero network tracking, zero accounts, zero
                      lock-in.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
