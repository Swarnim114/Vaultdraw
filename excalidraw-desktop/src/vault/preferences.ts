import { DEFAULT_SORT_ORDER, isSortOrder, type SortOrder } from "./sortOrder";

export type VaultTheme = "light" | "dark" | "system";

export interface VaultPreferences {
  recentVaults: string[];
  lastVaultPath: string | null;
  navigatorCollapsed: boolean;
  navigatorWidth: number;
  expandedFolders: Record<string, string[]>;
  theme: VaultTheme;
  /** Colour theme name: a built-in name or a theme in the config themes/ folder. */
  colorTheme: string;
  /** Make the canvas background, pencil and palette colours follow the theme. */
  syncCanvas: boolean;
  defaultFontFamily: number;
  defaultFontSize: number;
  defaultStrokeColor: string;
  defaultBackgroundColor: string;
  defaultFillStyle: string;
  defaultStrokeWidth: number;
  defaultRoughness: number;
  autosaveDelayMs: number;
  defaultCanvasBackground?: string;
  /** Replaces the theme's primary colour ("#rrggbb"); "" = the theme's own. */
  accentColor: string;
  /** Whole-window zoom in percent (webview zoom), 50 to 200. */
  zoom: number;
  /** Ask before moving a file or folder to the OS Trash. */
  confirmDelete: boolean;
  /** Global navigator sort order; a vault's settings.toml may override it. */
  navigatorSort: SortOrder;
  /** Folder for new drawings, relative to the vault root ("" = unset). A vault's settings.toml may override it. */
  newDrawingFolder: string;
}

const STORAGE_KEY = "excalidraw-vault-preferences-v1";

/** Excalidraw's FONT_FAMILY.Excalifont (packages/common/src/constants.ts). */
export const DEFAULT_FONT_FAMILY = 5;

export const DEFAULT_PREFERENCES: VaultPreferences = {
  recentVaults: [],
  lastVaultPath: null,
  navigatorCollapsed: false,
  navigatorWidth: 280,
  expandedFolders: {},
  theme: "system",
  colorTheme: "Default",
  syncCanvas: false,
  defaultFontFamily: DEFAULT_FONT_FAMILY,
  defaultFontSize: 20,
  defaultStrokeColor: "#1e1e1e",
  defaultBackgroundColor: "transparent",
  defaultFillStyle: "solid",
  defaultStrokeWidth: 2,
  defaultRoughness: 1,
  autosaveDelayMs: 500,
  defaultCanvasBackground: "#ffffff",
  accentColor: "",
  zoom: 100,
  confirmDelete: true,
  navigatorSort: DEFAULT_SORT_ORDER,
  newDrawingFolder: "",
};

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;

export const isVaultTheme = (value: unknown): value is VaultTheme =>
  value === "light" || value === "dark" || value === "system";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const isExpandedFolders = (
  value: unknown,
): value is Record<string, string[]> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every(isStringArray);

const pick = <T>(
  value: unknown,
  guard: (value: unknown) => boolean,
  fallback: T,
): T => (guard(value) ? (value as T) : fallback);

const isNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);
const isString = (value: unknown) => typeof value === "string";
const isBoolean = (value: unknown) => typeof value === "boolean";

/**
 * Field-by-field normalization of an untrusted preferences object: anything
 * with the wrong type falls back to that field's default.
 */
export function normalizePreferences(input: unknown): VaultPreferences {
  const parsed =
    input && typeof input === "object"
      ? (input as Partial<Record<keyof VaultPreferences, unknown>>)
      : {};
  const d = DEFAULT_PREFERENCES;
  return {
    ...d,
    ...(parsed as Partial<VaultPreferences>),
    recentVaults: Array.isArray(parsed.recentVaults)
      ? (parsed.recentVaults as string[])
      : [],
    lastVaultPath:
      typeof parsed.lastVaultPath === "string" ? parsed.lastVaultPath : null,
    navigatorCollapsed: pick(
      parsed.navigatorCollapsed,
      isBoolean,
      d.navigatorCollapsed,
    ),
    navigatorWidth: pick(parsed.navigatorWidth, isNumber, d.navigatorWidth),
    expandedFolders:
      parsed.expandedFolders && typeof parsed.expandedFolders === "object"
        ? (parsed.expandedFolders as Record<string, string[]>)
        : {},
    theme: isVaultTheme(parsed.theme) ? parsed.theme : d.theme,
    colorTheme:
      typeof parsed.colorTheme === "string" && parsed.colorTheme.trim()
        ? parsed.colorTheme
        : d.colorTheme,
    syncCanvas: pick(parsed.syncCanvas, isBoolean, d.syncCanvas),
    defaultFontFamily: pick(
      parsed.defaultFontFamily,
      isNumber,
      d.defaultFontFamily,
    ),
    defaultFontSize: pick(parsed.defaultFontSize, isNumber, d.defaultFontSize),
    defaultStrokeColor: pick(
      parsed.defaultStrokeColor,
      isString,
      d.defaultStrokeColor,
    ),
    defaultBackgroundColor: pick(
      parsed.defaultBackgroundColor,
      isString,
      d.defaultBackgroundColor,
    ),
    defaultFillStyle: pick(
      parsed.defaultFillStyle,
      isString,
      d.defaultFillStyle,
    ),
    defaultStrokeWidth: pick(
      parsed.defaultStrokeWidth,
      isNumber,
      d.defaultStrokeWidth,
    ),
    defaultRoughness: pick(
      parsed.defaultRoughness,
      isNumber,
      d.defaultRoughness,
    ),
    autosaveDelayMs: pick(parsed.autosaveDelayMs, isNumber, d.autosaveDelayMs),
    defaultCanvasBackground: pick(
      parsed.defaultCanvasBackground,
      isString,
      d.defaultCanvasBackground,
    ),
    accentColor: pick(parsed.accentColor, isString, d.accentColor),
    zoom: pick(
      parsed.zoom,
      (v) =>
        isNumber(v) && (v as number) >= MIN_ZOOM && (v as number) <= MAX_ZOOM,
      d.zoom,
    ),
    confirmDelete: pick(parsed.confirmDelete, isBoolean, d.confirmDelete),
    navigatorSort: pick(parsed.navigatorSort, isSortOrder, d.navigatorSort),
    newDrawingFolder: pick(
      parsed.newDrawingFolder,
      isString,
      d.newDrawingFolder,
    ),
  };
}

const clonePreferences = (prefs: VaultPreferences): VaultPreferences => ({
  ...prefs,
  recentVaults: [...prefs.recentVaults],
  expandedFolders: { ...prefs.expandedFolders },
});

// ---------------------------------------------------------------------------
// In-memory store (desktop config folder mode)
//
// In the Tauri app, settingsSync.ts attaches an in-memory store hydrated from
// config.toml + state.json. Reads come from memory; writes update memory
// synchronously and hand the change to the store's persist callback. Without
// an attached store (browser harness, unit tests) the module keeps its
// original localStorage behaviour.
// ---------------------------------------------------------------------------

type PersistCallback = (next: VaultPreferences, prev: VaultPreferences) => void;

let memoryStore: {
  prefs: VaultPreferences;
  persist: PersistCallback;
} | null = null;

export function attachPreferencesStore(
  initial: VaultPreferences,
  persist: PersistCallback,
): void {
  memoryStore = { prefs: clonePreferences(initial), persist };
}

export function detachPreferencesStore(): void {
  memoryStore = null;
}

export function isPreferencesStoreAttached(): boolean {
  return memoryStore !== null;
}

/** Replace the in-memory preferences without persisting (used on reload). */
export function replaceStoredPreferences(next: VaultPreferences): void {
  if (memoryStore) {
    memoryStore.prefs = clonePreferences(next);
  }
}

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

/** Raw preferences object stored in localStorage, if any (for migration). */
export function readLocalStoragePreferences(
  win?: Window | null,
): Partial<VaultPreferences> | null {
  const storage = getStorage(win);
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Partial<VaultPreferences>)
      : null;
  } catch {
    return null;
  }
}

export function getPreferences(win?: Window | null): VaultPreferences {
  if (memoryStore) {
    return clonePreferences(memoryStore.prefs);
  }
  const parsed = readLocalStoragePreferences(win);
  if (!parsed) {
    return { ...DEFAULT_PREFERENCES };
  }
  return normalizePreferences(parsed);
}

export function updatePreferences(
  partial: Partial<VaultPreferences>,
  win?: Window | null,
): VaultPreferences {
  if (memoryStore) {
    const prev = memoryStore.prefs;
    const next: VaultPreferences = { ...prev, ...partial };
    memoryStore.prefs = next;
    try {
      memoryStore.persist(clonePreferences(next), clonePreferences(prev));
    } catch {
      // persistence failures are reported by the store, never thrown here
    }
    return clonePreferences(next);
  }
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
