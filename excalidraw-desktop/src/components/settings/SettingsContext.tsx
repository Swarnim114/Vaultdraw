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
  subscribePreferences,
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

import { clampZoom } from "../../vault/zoom";
import { useVaultSettingsView } from "../../vault/useVaultSettingsView";

import type { UseVaultSettings } from "../../vault/useVaultSettings";
import type { VaultPreferences } from "../../vault/preferences";
import type { VaultInfo } from "../../vault/types";
import type { VaultField } from "../../vault/vaultSettings";

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

  /** "" = the theme's own primary colour. */
  accentColor: string;
  setAccentColor: (hex: string) => void;

  zoom: number;
  setZoom: (percent: number) => void;

  confirmDelete: boolean;
  setConfirmDelete: (next: boolean) => void;
  showTagChips: boolean;
  setShowTagChips: (next: boolean) => void;

  /** Read-only view of the per-vault store (overrides, effective values). */
  vaultSettings: UseVaultSettings;
  /** Edit a per-vault field in whichever layer is active. */
  setPerVaultValue: <F extends VaultField>(
    field: F,
    value: VaultPreferences[F],
  ) => void;
  /** On: store the effective value in the vault; off: use the global one. */
  setPerVaultStored: (field: VaultField, stored: boolean) => void;

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
  const [accentColor, setAccentColorState] = useState(
    () => getPreferences(win).accentColor,
  );
  const [zoom, setZoomState] = useState(() => getPreferences(win).zoom);
  const [confirmDelete, setConfirmDeleteState] = useState(
    () => getPreferences(win).confirmDelete,
  );
  const [showTagChips, setShowTagChipsState] = useState(
    () => getPreferences(win).showTagChips,
  );
  const vaultSettings = useVaultSettingsView(win);
  const [settingsStatus, setSettingsStatus] = useState(getSettingsStatus);

  // The view.zoom* shortcuts change the zoom while Settings may be open.
  useEffect(
    () => subscribePreferences(() => setZoomState(getPreferences(win).zoom)),
    [win],
  );

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
      setAccentColorState(prefs.accentColor);
      setZoomState(prefs.zoom);
      setConfirmDeleteState(prefs.confirmDelete);
      setShowTagChipsState(prefs.showTagChips);
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

  const setAccentColor = (hex: string) => {
    setAccentColorState(hex);
    updatePreferences({ accentColor: hex }, win);
    onAppearanceChanged?.();
  };

  const setZoom = (percent: number) => {
    const next = clampZoom(percent);
    setZoomState(next);
    updatePreferences({ zoom: next }, win);
  };

  const setConfirmDelete = (next: boolean) => {
    setConfirmDeleteState(next);
    updatePreferences({ confirmDelete: next }, win);
  };

  const setShowTagChips = (next: boolean) => {
    setShowTagChipsState(next);
    updatePreferences({ showTagChips: next }, win);
  };

  const setPerVaultValue = <F extends VaultField>(
    field: F,
    value: VaultPreferences[F],
  ) => {
    if (vaultSettings.isOverridden(field)) {
      void vaultSettings.setOverride(field, value);
    } else {
      updatePreferences({ [field]: value }, win);
    }
  };

  const setPerVaultStored = (field: VaultField, stored: boolean) => {
    void vaultSettings.setOverride(
      field,
      stored ? vaultSettings.effective[field] : null,
    );
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
    accentColor,
    setAccentColor,
    zoom,
    setZoom,
    confirmDelete,
    setConfirmDelete,
    showTagChips,
    setShowTagChips,
    vaultSettings,
    setPerVaultValue,
    setPerVaultStored,
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
  /** Shown in search results instead of `Component` (a heavy custom page). */
  SearchComponent?: () => ReactElement | null;
  /** False hides the setting (and excludes it from search). */
  available?: (ctx: SettingsContextValue) => boolean;
}

export type SettingControls = Record<string, SettingControl>;
