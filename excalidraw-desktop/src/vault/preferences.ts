export type VaultTheme = "light" | "dark" | "system";

export interface VaultPreferences {
  recentVaults: string[];
  lastVaultPath: string | null;
  navigatorCollapsed: boolean;
  navigatorWidth: number;
  expandedFolders: Record<string, string[]>;
  theme: VaultTheme;
  defaultFontFamily: number;
  defaultFontSize: number;
  defaultStrokeColor: string;
  defaultBackgroundColor: string;
  defaultFillStyle: string;
  defaultStrokeWidth: number;
  defaultRoughness: number;
  autosaveDelayMs: number;
  defaultCanvasBackground?: string;
}

const STORAGE_KEY = "excalidraw-vault-preferences-v1";

export const DEFAULT_PREFERENCES: VaultPreferences = {
  recentVaults: [],
  lastVaultPath: null,
  navigatorCollapsed: false,
  navigatorWidth: 280,
  expandedFolders: {},
  theme: "system",
  defaultFontFamily: 1,
  defaultFontSize: 20,
  defaultStrokeColor: "#1e1e1e",
  defaultBackgroundColor: "transparent",
  defaultFillStyle: "solid",
  defaultStrokeWidth: 2,
  defaultRoughness: 1,
  autosaveDelayMs: 500,
  defaultCanvasBackground: "#ffffff",
};

function getStorage(win?: Window | null): Storage | null {
  try {
    return (
      win?.localStorage ??
      (typeof window !== "undefined" ? window.localStorage : null)
    );
  } catch {
    return null;
  }
}

export function getPreferences(win?: Window | null): VaultPreferences {
  const storage = getStorage(win);
  if (!storage) {
    return { ...DEFAULT_PREFERENCES };
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFERENCES };
    }
    const parsed = JSON.parse(raw) as Partial<VaultPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      recentVaults: Array.isArray(parsed.recentVaults)
        ? parsed.recentVaults
        : [],
      expandedFolders:
        parsed.expandedFolders && typeof parsed.expandedFolders === "object"
          ? parsed.expandedFolders
          : {},
      theme:
        parsed.theme === "light" ||
        parsed.theme === "dark" ||
        parsed.theme === "system"
          ? parsed.theme
          : DEFAULT_PREFERENCES.theme,
      defaultFontFamily:
        typeof parsed.defaultFontFamily === "number"
          ? parsed.defaultFontFamily
          : DEFAULT_PREFERENCES.defaultFontFamily,
      defaultFontSize:
        typeof parsed.defaultFontSize === "number"
          ? parsed.defaultFontSize
          : DEFAULT_PREFERENCES.defaultFontSize,
      defaultStrokeColor:
        typeof parsed.defaultStrokeColor === "string"
          ? parsed.defaultStrokeColor
          : DEFAULT_PREFERENCES.defaultStrokeColor,
      defaultBackgroundColor:
        typeof parsed.defaultBackgroundColor === "string"
          ? parsed.defaultBackgroundColor
          : DEFAULT_PREFERENCES.defaultBackgroundColor,
      defaultFillStyle:
        typeof parsed.defaultFillStyle === "string"
          ? parsed.defaultFillStyle
          : DEFAULT_PREFERENCES.defaultFillStyle,
      defaultStrokeWidth:
        typeof parsed.defaultStrokeWidth === "number"
          ? parsed.defaultStrokeWidth
          : DEFAULT_PREFERENCES.defaultStrokeWidth,
      defaultRoughness:
        typeof parsed.defaultRoughness === "number"
          ? parsed.defaultRoughness
          : DEFAULT_PREFERENCES.defaultRoughness,
      autosaveDelayMs:
        typeof parsed.autosaveDelayMs === "number"
          ? parsed.autosaveDelayMs
          : DEFAULT_PREFERENCES.autosaveDelayMs,
      defaultCanvasBackground:
        typeof parsed.defaultCanvasBackground === "string"
          ? parsed.defaultCanvasBackground
          : DEFAULT_PREFERENCES.defaultCanvasBackground,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function updatePreferences(
  partial: Partial<VaultPreferences>,
  win?: Window | null,
): VaultPreferences {
  const current = getPreferences(win);
  const next: VaultPreferences = {
    ...current,
    ...partial,
  };
  const storage = getStorage(win);
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // quota or security error ignored gracefully
    }
  }
  return next;
}

export function loadPreferences(win?: Window | null): VaultPreferences {
  return getPreferences(win);
}

export function savePreferences(
  partial: Partial<VaultPreferences>,
  win?: Window | null,
): VaultPreferences {
  return updatePreferences(partial, win);
}

export function resolveTheme(
  theme: VaultTheme,
  win?: Window | null,
): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  if (win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
    return "dark";
  }
  return "light";
}

export function getTheme(win?: Window | null): VaultTheme {
  return getPreferences(win).theme;
}

export function setTheme(theme: VaultTheme, win?: Window | null): void {
  updatePreferences({ theme }, win);
}

export function getAutosaveDelayMs(win?: Window | null): number {
  return getPreferences(win).autosaveDelayMs;
}

export function setAutosaveDelayMs(delayMs: number, win?: Window | null): void {
  updatePreferences({ autosaveDelayMs: delayMs }, win);
}

export function getEditorDefaults(win?: Window | null) {
  const prefs = getPreferences(win);
  return {
    defaultFontFamily: prefs.defaultFontFamily,
    defaultFontSize: prefs.defaultFontSize,
    defaultStrokeColor: prefs.defaultStrokeColor,
    defaultBackgroundColor: prefs.defaultBackgroundColor,
    defaultFillStyle: prefs.defaultFillStyle,
    defaultStrokeWidth: prefs.defaultStrokeWidth,
    defaultRoughness: prefs.defaultRoughness,
    defaultCanvasBackground: prefs.defaultCanvasBackground,
  };
}

export function setEditorDefaults(
  defaults: Partial<
    Pick<
      VaultPreferences,
      | "defaultFontFamily"
      | "defaultFontSize"
      | "defaultStrokeColor"
      | "defaultBackgroundColor"
      | "defaultFillStyle"
      | "defaultStrokeWidth"
      | "defaultRoughness"
      | "defaultCanvasBackground"
    >
  >,
  win?: Window | null,
): void {
  updatePreferences(defaults, win);
}

export function getRecentVaults(win?: Window | null): string[] {
  return getPreferences(win).recentVaults;
}

export function getLastVaultPath(win?: Window | null): string | null {
  return getPreferences(win).lastVaultPath;
}

export function addRecentVault(vaultPath: string, win?: Window | null): void {
  if (!vaultPath) {
    return;
  }
  const current = getRecentVaults(win);
  const filtered = current.filter((p) => p !== vaultPath);
  const updated = [vaultPath, ...filtered].slice(0, 10);
  updatePreferences({ recentVaults: updated, lastVaultPath: vaultPath }, win);
}

export function removeRecentVault(
  vaultPath: string,
  win?: Window | null,
): void {
  const current = getRecentVaults(win);
  const updated = current.filter((p) => p !== vaultPath);
  updatePreferences({ recentVaults: updated }, win);
}

export function getExpandedFolders(
  vaultKey: string,
  win?: Window | null,
): string[] {
  const prefs = getPreferences(win);
  return prefs.expandedFolders[vaultKey] ?? [""];
}

export function setExpandedFolders(
  vaultKey: string,
  folders: string[],
  win?: Window | null,
): void {
  const current = getPreferences(win);
  const nextExpanded = {
    ...current.expandedFolders,
    [vaultKey]: folders,
  };
  updatePreferences({ expandedFolders: nextExpanded }, win);
}

export function toggleFolderExpanded(
  vaultKey: string,
  folderPath: string,
  win?: Window | null,
): boolean {
  const current = new Set(getExpandedFolders(vaultKey, win));
  let isExpanded: boolean;
  if (current.has(folderPath)) {
    current.delete(folderPath);
    isExpanded = false;
  } else {
    current.add(folderPath);
    isExpanded = true;
  }
  setExpandedFolders(vaultKey, Array.from(current), win);
  return isExpanded;
}

export function getNavigatorCollapsed(win?: Window | null): boolean {
  return getPreferences(win).navigatorCollapsed;
}

export function setNavigatorCollapsed(
  collapsed: boolean,
  win?: Window | null,
): void {
  updatePreferences({ navigatorCollapsed: collapsed }, win);
}
