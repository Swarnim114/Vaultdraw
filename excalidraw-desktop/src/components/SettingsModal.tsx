import { useEffect, useRef, useState } from "react";

import {
  getEditorDefaults,
  getPreferences,
  getTheme,
  resolveTheme,
  setAutosaveDelayMs,
  setEditorDefaults,
  setTheme,
  type VaultTheme,
} from "../vault/preferences";

import {
  IconClose,
  IconDrawing,
  IconFolder,
  IconReveal,
  IconSettings,
} from "./Icons";

import type { VaultInfo } from "../vault/types";

export interface SettingsModalProps {
  vault: VaultInfo | null;
  onClose: () => void;
  onThemeChanged?: (resolvedTheme: "light" | "dark") => void;
  onRevealVault?: (path: string) => void;
  ownerDocument?: Document | null;
}

type SettingsTab = "appearance" | "editor" | "vault" | "about";

export const SettingsModal = ({
  vault,
  onClose,
  onThemeChanged,
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
  const [defaults, setDefaultsState] = useState(() => getEditorDefaults(win));
  const [autosaveDelay, setAutosaveDelayState] = useState(
    () => getPreferences(win).autosaveDelayMs,
  );

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
  };

  const handleUpdateDefaults = (
    partial: Parameters<typeof setEditorDefaults>[0],
  ) => {
    setDefaultsState((prev) => {
      const next = { ...prev, ...partial };
      setEditorDefaults(next, win);
      return next;
    });
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
                <div className="vault-setting-row">
                  <div className="vault-setting-info">
                    <div className="vault-setting-label">Theme Mode</div>
                    <div className="vault-setting-desc">
                      Choose canvas and interface theme with instant preview.
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
                    <div className="vault-setting-label">
                      Default Canvas Background
                    </div>
                    <div className="vault-setting-desc">
                      Background color applied to newly created drawings.
                    </div>
                  </div>
                  <div className="vault-color-options">
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
                  </div>
                </div>
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
                    <option value={1}>1: Excalifont (Hand-drawn)</option>
                    <option value={2}>2: Nunito (Clean / Normal)</option>
                    <option value={3}>
                      3: Comic Shanns (Code / Monospace)
                    </option>
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
