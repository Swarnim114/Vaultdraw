import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";

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
} from "../../vault/preferences";
import {
  getSettingsStatus,
  PREFERENCES_CHANGED_EVENT,
  SETTINGS_STATUS_EVENT,
  type SettingsStatus,
} from "../../vault/settingsSync";
import {
  getThemeRegistry,
  resolveSelectedTheme,
  type ThemeEntry,
  type ThemeRegistry,
} from "../../theme/registry";

import type { VaultInfo } from "../../vault/types";

export type EditorDefaults = ReturnType<typeof getEditorDefaults>;

/**
 * Shared state for every settings control. The shell owns it so a control
 * behaves the same on its page and in search results.
 */
export interface SettingsContextValue {
  win: Window | null;
  vault: VaultInfo | null;
  onRevealVault?: (path: string) => void;

  mode: VaultTheme;
  setMode: (mode: VaultTheme) => void;

  registry: ThemeRegistry;
  selection: ReturnType<typeof resolveSelectedTheme>;
  selectColourTheme: (entry: ThemeEntry) => void;

  syncCanvas: boolean;
  setSyncCanvas: (next: boolean) => void;

  defaults: EditorDefaults;
  updateDefaults: (partial: Parameters<typeof setEditorDefaults>[0]) => void;

  autosaveDelay: number;
  setAutosaveDelay: (ms: number) => void;

  settingsStatus: SettingsStatus;
  setSettingsStatus: (status: SettingsStatus) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider = SettingsContext.Provider;

export const useSettings = (): SettingsContextValue => {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used inside <SettingsModal>");
  }
  return value;
};

export interface SettingsControllerOptions {
  win: Window | null;
  doc: Document | null;
  vault: VaultInfo | null;
  themeRegistry?: ThemeRegistry;
  onThemeChanged?: (resolvedTheme: "light" | "dark") => void;
  onAppearanceChanged?: () => void;
  onRevealVault?: (path: string) => void;
}

export const useSettingsController = ({
  win,
  doc,
  vault,
  themeRegistry,
  onThemeChanged,
  onAppearanceChanged,
  onRevealVault,
}: SettingsControllerOptions): SettingsContextValue => {
  const [mode, setModeState] = useState<VaultTheme>(() => getTheme(win));
  const [colorTheme, setColorThemeState] = useState(
    () => getPreferences(win).colorTheme,
  );
  const [syncCanvas, setSyncCanvasState] = useState(
    () => getPreferences(win).syncCanvas,
  );
  // Stable between renders: getThemeRegistry() without a cache builds new
  // entries each call, which would defeat the picker's memoised cards.
  const registry = useMemo(
    () => themeRegistry ?? getThemeRegistry(),
    [themeRegistry],
  );
  const selection = resolveSelectedTheme(registry, colorTheme);
  const [defaults, setDefaultsState] = useState(() => getEditorDefaults(win));
  const [autosaveDelay, setAutosaveDelayState] = useState(
    () => getPreferences(win).autosaveDelayMs,
  );
  const [settingsStatus, setSettingsStatus] = useState(getSettingsStatus);

  // Refresh displayed values when config.toml is reloaded while open.
  useEffect(() => {
    if (!win) {
      return;
    }
    const handlePreferencesChanged = () => {
      const prefs = getPreferences(win);
      setModeState(prefs.theme);
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

  const setMode = (next: VaultTheme) => {
    setModeState(next);
    setTheme(next, win);
    const resolved = resolveTheme(next, win);
    const targetDoc =
      doc ?? (typeof document !== "undefined" ? document : null);
    targetDoc?.documentElement.classList.toggle("dark", resolved === "dark");
    onThemeChanged?.(resolved);
    onAppearanceChanged?.();
  };

  const selectColourTheme = (entry: ThemeEntry) => {
    // summary.key is the value stored in appearance.theme.
    const { key } = entry.summary;
    setColorThemeState(key);
    updatePreferences({ colorTheme: key }, win);
    onAppearanceChanged?.();
  };

  const setSyncCanvas = (next: boolean) => {
    setSyncCanvasState(next);
    updatePreferences({ syncCanvas: next }, win);
    onAppearanceChanged?.();
  };

  const updateDefaults = (partial: Parameters<typeof setEditorDefaults>[0]) => {
    setEditorDefaults(partial, win);
    setDefaultsState(getEditorDefaults(win));
  };

  const setAutosaveDelay = (ms: number) => {
    setAutosaveDelayState(ms);
    setAutosaveDelayMs(ms, win);
  };

  return {
    win,
    vault,
    onRevealVault,
    mode,
    setMode,
    registry,
    selection,
    selectColourTheme,
    syncCanvas,
    setSyncCanvas,
    defaults,
    updateDefaults,
    autosaveDelay,
    setAutosaveDelay,
    settingsStatus,
    setSettingsStatus,
  };
};

/** A setting's control, rendered on its page and in search results. */
export interface SettingControl {
  Component: () => ReactElement | null;
  /** False hides the setting (and excludes it from search). */
  available?: (ctx: SettingsContextValue) => boolean;
}

export type SettingControls = Record<string, SettingControl>;
