import {
  BACKGROUND_PATTERN_LIMITS,
  isBackgroundPatternType,
  type BackgroundPatternType,
} from "@excalidraw/excalidraw/data/backgroundPattern";

import {
  DEFAULT_LINKS_SETTINGS,
  type LinksSettings,
  type NewLinkFormat,
  type OpenModifier,
  type ShapeLinkFormat,
  type UpdateOnRename,
} from "../links/types";
  PAGE_LIMITS,
  isPageLayout,
  isPageOrientation,
  isPageSize,
  type PageLayout,
  type PageOrientation,
  type PageSize,
} from "@excalidraw/excalidraw/data/pageSetup";

import { DEFAULT_TEMPLATES_FOLDER } from "../templates/types";
import {
  DEFAULT_LASER,
  LASER_LIMITS,
  inRange,
  type LaserSettings,
} from "../pens/laserSettings";
import {
  DEFAULT_PEN_PRESETS,
  isPenPresets,
  withPenDefaults,
  type PenPreset,
} from "../pens/penPresets";

import {
  isToolStyle,
  TOOL_DEFAULT_TOOLS,
  toolField,
  type ToolField,
  type ToolStyle,
} from "../toolDefaults/toolStyles";

import { DEFAULT_SORT_ORDER, isSortOrder, type SortOrder } from "./sortOrder";

export type VaultTheme = "light" | "dark" | "system";

/** Last-used image export options (machine state, not a user setting). */
export interface ExportOptions {
  scale: 1 | 2 | 3;
  background: boolean;
  embedScene: boolean;
  /** Draw the paper pattern in exports that include the background. */
  pattern: boolean;
  /** Page mode: export the whole page column instead of the content. */
  pageShaped: boolean;
}

const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;

/** Same default scale as the editor (appState.ts defaultExportScale). */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  scale: dpr === 2 || dpr === 3 ? dpr : 1,
  background: true,
  embedScene: false,
  pattern: true,
  pageShaped: false,
};

export function normalizeExportOptions(input: unknown): ExportOptions {
  const o =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const d = DEFAULT_EXPORT_OPTIONS;
  return {
    scale: o.scale === 1 || o.scale === 2 || o.scale === 3 ? o.scale : d.scale,
    background: typeof o.background === "boolean" ? o.background : d.background,
    embedScene: typeof o.embedScene === "boolean" ? o.embedScene : d.embedScene,
    pattern: typeof o.pattern === "boolean" ? o.pattern : d.pattern,
    pageShaped: typeof o.pageShaped === "boolean" ? o.pageShaped : d.pageShaped,
  };
}

/** Paper style of new drawings; "plain" = no pattern. */
export type PaperStyle = "plain" | BackgroundPatternType;

/** Default mode of new drawings: the infinite canvas or simulated pages. */
export type PageModeDefault = "normal" | "page";
/** Paper theme as spelled in config.toml (the model uses "oldSchool"). */
export type PagePaperTheme = "normal" | "old_school" | "match";

interface VaultPreferencesBase {
  recentVaults: string[];
  lastVaultPath: string | null;
  navigatorCollapsed: boolean;
  navigatorWidth: number;
  expandedFolders: Record<string, string[]>;
  exportOptions: ExportOptions;
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
  /** Paper pattern of new drawings. A vault's settings.toml may override the style. */
  paperStyle: PaperStyle;
  /** Distance between lines or dots in scene units; 0 = the style's preset. */
  paperSpacing: number;
  /** Pattern colour "#rrggbb"; "" = automatic. */
  paperColor: string;
  paperOpacity: number;
  /** Grid and graph: a major line every N; 0 = the style's preset. */
  paperMajorEvery: number;
  /** Ruled lines only. */
  paperMarginLine: boolean;
  /** Page mode defaults for new drawings (`[page]`). */
  pageMode: PageModeDefault;
  pageLayout: PageLayout;
  /** A preset id or "custom". */
  pageSize: PageSize;
  pageOrientation: PageOrientation;
  /** Custom page size in px, used when pageSize is "custom"; 0 = unset. */
  pageWidth: number;
  pageHeight: number;
  pagePaperTheme: PagePaperTheme;
  /** Replaces the theme's primary colour ("#rrggbb"); "" = the theme's own. */
  accentColor: string;
  /** Whole-window zoom in percent (webview zoom), 50 to 200. */
  zoom: number;
  /** Ask before moving a file or folder to the OS Trash. */
  confirmDelete: boolean;
  /** Show small tag chips after drawing names in the file tree. */
  showTagChips: boolean;
  /** Global navigator sort order; a vault's settings.toml may override it. */
  navigatorSort: SortOrder;
  /** Folder for new drawings, relative to the vault root ("" = unset). A vault's settings.toml may override it. */
  newDrawingFolder: string;
  /**
   * Vault folder holding templates, relative to the vault root. Never empty:
   * "" is not a valid value and falls back to "Templates". A vault's
   * settings.toml may override it.
   */
  templatesFolder: string;
  /** links.new_link_format */
  linkNewFormat: NewLinkFormat;
  /** links.shape_link_format */
  linkShapeFormat: ShapeLinkFormat;
  /** links.open_modifier */
  linkOpenModifier: OpenModifier;
  /** links.update_on_rename */
  linkUpdateOnRename: UpdateOnRename;
  /** links.autocomplete */
  linkAutocomplete: boolean;
  /** links.hint_chars */
  linkHintChars: string;
  /** Hotkey overrides (`[hotkeys]`): command id -> chords. [] = unassigned. */
  hotkeys: Record<string, string[]>;
  /** Saved pens (1 to 9), selected with the pen.selectN commands (Alt+1..9). */
  penPresets: PenPreset[];
  laserColor: string;
  laserSize: number;
  laserDecayMs: number;
  laserLength: number;
}

/** Saved default style per drawing tool (`[tools.<tool>]`); {} = none. */
export type VaultPreferences = VaultPreferencesBase &
  Record<ToolField, ToolStyle>;

const STORAGE_KEY = "excalidraw-vault-preferences-v1";

/** Excalidraw's FONT_FAMILY.Excalifont (packages/common/src/constants.ts). */
export const DEFAULT_FONT_FAMILY = 5;

const emptyToolStyles = () =>
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => [toolField(tool), {}]),
  ) as Record<ToolField, ToolStyle>;

const cloneToolStyles = (prefs: Record<ToolField, ToolStyle>) =>
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => [
      toolField(tool),
      { ...prefs[toolField(tool)] },
    ]),
  ) as Record<ToolField, ToolStyle>;

/** Untrusted -> a valid style per tool; anything invalid becomes {}. */
const normalizeToolStyles = (parsed: Partial<Record<ToolField, unknown>>) =>
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => {
      const value = parsed[toolField(tool)];
      return [
        toolField(tool),
        isToolStyle(tool, value) ? { ...(value as ToolStyle) } : {},
      ];
    }),
  ) as Record<ToolField, ToolStyle>;

export const DEFAULT_PREFERENCES: VaultPreferences = {
  recentVaults: [],
  lastVaultPath: null,
  navigatorCollapsed: false,
  navigatorWidth: 280,
  expandedFolders: {},
  exportOptions: DEFAULT_EXPORT_OPTIONS,
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
  paperStyle: "plain",
  paperSpacing: 0,
  paperColor: "",
  paperOpacity: 1,
  paperMajorEvery: 0,
  paperMarginLine: true,
  pageMode: "normal",
  pageLayout: "separate",
  pageSize: "a4",
  pageOrientation: "portrait",
  pageWidth: 0,
  pageHeight: 0,
  pagePaperTheme: "normal",
  accentColor: "",
  zoom: 100,
  confirmDelete: true,
  showTagChips: true,
  navigatorSort: DEFAULT_SORT_ORDER,
  newDrawingFolder: "",
  templatesFolder: DEFAULT_TEMPLATES_FOLDER,
  linkNewFormat: DEFAULT_LINKS_SETTINGS.newLinkFormat,
  linkShapeFormat: DEFAULT_LINKS_SETTINGS.shapeLinkFormat,
  linkOpenModifier: DEFAULT_LINKS_SETTINGS.openModifier,
  linkUpdateOnRename: DEFAULT_LINKS_SETTINGS.updateOnRename,
  linkAutocomplete: DEFAULT_LINKS_SETTINGS.autocomplete,
  linkHintChars: DEFAULT_LINKS_SETTINGS.hintChars,
  hotkeys: {},
  penPresets: DEFAULT_PEN_PRESETS.map((p) => ({ ...p })),
  laserColor: DEFAULT_LASER.color,
  laserSize: DEFAULT_LASER.size,
  laserDecayMs: DEFAULT_LASER.decayMs,
  laserLength: DEFAULT_LASER.length,
  ...emptyToolStyles(),
};

/** The laser fields of the preferences as one settings object. */
export const getLaserSettings = (prefs: VaultPreferences): LaserSettings => ({
  color: prefs.laserColor,
  size: prefs.laserSize,
  decayMs: prefs.laserDecayMs,
  length: prefs.laserLength,
});

/** The links fields of the preferences as one settings object. */
export const getLinksSettings = (prefs: VaultPreferences): LinksSettings => ({
  newLinkFormat: prefs.linkNewFormat,
  shapeLinkFormat: prefs.linkShapeFormat,
  openModifier: prefs.linkOpenModifier,
  updateOnRename: prefs.linkUpdateOnRename,
  autocomplete: prefs.linkAutocomplete,
  hintChars: prefs.linkHintChars,
});

export const isNewLinkFormat = (v: unknown): v is NewLinkFormat =>
  v === "shortest" || v === "relative" || v === "absolute";
export const isShapeLinkFormat = (v: unknown): v is ShapeLinkFormat =>
  v === "wikilink" || v === "vaultdraw-url";
export const isOpenModifier = (v: unknown): v is OpenModifier =>
  v === "mod" || v === "alt" || v === "ctrl" || v === "shift";
export const isUpdateOnRename = (v: unknown): v is UpdateOnRename =>
  typeof v === "boolean" || v === "ask";
/** At least 2 distinct characters, no whitespace, nothing uppercase. */
export const isHintChars = (v: unknown): v is string => {
  if (typeof v !== "string" || /\s/.test(v) || v !== v.toLowerCase()) {
    return false;
  }
  const chars = Array.from(v);
  return chars.length >= 2 && new Set(chars).size === chars.length;
};

const PAPER_LIMITS = BACKGROUND_PATTERN_LIMITS;

export const isPaperStyle = (value: unknown): value is PaperStyle =>
  value === "plain" || isBackgroundPatternType(value);

/** "" = automatic colour. */
export const isPaperColor = (value: unknown): value is string =>
  value === "" || (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value));

/** 0 = the style's preset. */
export const isPaperSpacing = (value: unknown) =>
  value === 0 || inRange(value, PAPER_LIMITS.spacing);
export const isPaperOpacity = (value: unknown) =>
  inRange(value, PAPER_LIMITS.opacity);
export const isPaperMajorEvery = (value: unknown) =>
  value === 0 ||
  (Number.isInteger(value) && inRange(value, PAPER_LIMITS.majorEvery));

export const isPageMode = (value: unknown): value is PageModeDefault =>
  value === "normal" || value === "page";
export const isPagePaperTheme = (value: unknown): value is PagePaperTheme =>
  value === "normal" || value === "old_school" || value === "match";
/** 0 = unset (the A4 side is used). */
export const isPageSide = (value: unknown) =>
  value === 0 || (Number.isInteger(value) && inRange(value, PAGE_LIMITS.side));

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

/** Keep only entries whose value is an array of strings. */
export const normalizeHotkeys = (value: unknown): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, keys] of Object.entries(value)) {
      if (isStringArray(keys)) {
        result[id] = [...keys];
      }
    }
  }
  return result;
};

const pick = <T>(
  value: unknown,
  guard: (value: unknown) => boolean,
  fallback: T,
): T => (guard(value) ? (value as T) : fallback);

const isNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);
const isString = (value: unknown) => typeof value === "string";
const isBoolean = (value: unknown) => typeof value === "boolean";

/** Presets with missing optional fields filled in; invalid -> fallback. */
const normalizePenPresets = (value: unknown, fallback: PenPreset[]) => {
  const filled = withPenDefaults(value);
  return isPenPresets(filled) ? filled : fallback.map((p) => ({ ...p }));
};

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
    exportOptions: normalizeExportOptions(parsed.exportOptions),
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
    paperStyle: pick(parsed.paperStyle, isPaperStyle, d.paperStyle),
    paperSpacing: pick(parsed.paperSpacing, isPaperSpacing, d.paperSpacing),
    paperColor: pick(parsed.paperColor, isPaperColor, d.paperColor),
    paperOpacity: pick(parsed.paperOpacity, isPaperOpacity, d.paperOpacity),
    paperMajorEvery: pick(
      parsed.paperMajorEvery,
      isPaperMajorEvery,
      d.paperMajorEvery,
    ),
    paperMarginLine: pick(parsed.paperMarginLine, isBoolean, d.paperMarginLine),
    pageMode: pick(parsed.pageMode, isPageMode, d.pageMode),
    pageLayout: pick(parsed.pageLayout, isPageLayout, d.pageLayout),
    pageSize: pick(parsed.pageSize, isPageSize, d.pageSize),
    pageOrientation: pick(
      parsed.pageOrientation,
      isPageOrientation,
      d.pageOrientation,
    ),
    pageWidth: pick(parsed.pageWidth, isPageSide, d.pageWidth),
    pageHeight: pick(parsed.pageHeight, isPageSide, d.pageHeight),
    pagePaperTheme: pick(
      parsed.pagePaperTheme,
      isPagePaperTheme,
      d.pagePaperTheme,
    ),
    accentColor: pick(parsed.accentColor, isString, d.accentColor),
    zoom: pick(
      parsed.zoom,
      (v) =>
        isNumber(v) && (v as number) >= MIN_ZOOM && (v as number) <= MAX_ZOOM,
      d.zoom,
    ),
    confirmDelete: pick(parsed.confirmDelete, isBoolean, d.confirmDelete),
    showTagChips: pick(parsed.showTagChips, isBoolean, d.showTagChips),
    navigatorSort: pick(parsed.navigatorSort, isSortOrder, d.navigatorSort),
    newDrawingFolder: pick(
      parsed.newDrawingFolder,
      isString,
      d.newDrawingFolder,
    ),
    templatesFolder: pick(
      parsed.templatesFolder,
      (v) => isString(v) && (v as string).trim() !== "",
      d.templatesFolder,
    ),
    linkNewFormat: pick(parsed.linkNewFormat, isNewLinkFormat, d.linkNewFormat),
    linkShapeFormat: pick(
      parsed.linkShapeFormat,
      isShapeLinkFormat,
      d.linkShapeFormat,
    ),
    linkOpenModifier: pick(
      parsed.linkOpenModifier,
      isOpenModifier,
      d.linkOpenModifier,
    ),
    linkUpdateOnRename: pick(
      parsed.linkUpdateOnRename,
      isUpdateOnRename,
      d.linkUpdateOnRename,
    ),
    linkAutocomplete: pick(
      parsed.linkAutocomplete,
      isBoolean,
      d.linkAutocomplete,
    ),
    linkHintChars: pick(parsed.linkHintChars, isHintChars, d.linkHintChars),
    hotkeys: normalizeHotkeys(parsed.hotkeys),
    penPresets: normalizePenPresets(parsed.penPresets, d.penPresets),
    laserColor: pick(parsed.laserColor, isString, d.laserColor),
    laserSize: pick(
      parsed.laserSize,
      (v) => inRange(v, LASER_LIMITS.size),
      d.laserSize,
    ),
    laserDecayMs: pick(
      parsed.laserDecayMs,
      (v) => inRange(v, LASER_LIMITS.decayMs),
      d.laserDecayMs,
    ),
    laserLength: pick(
      parsed.laserLength,
      (v) => inRange(v, LASER_LIMITS.length),
      d.laserLength,
    ),
    ...normalizeToolStyles(parsed as Partial<Record<ToolField, unknown>>),
  };
}

const clonePreferences = (prefs: VaultPreferences): VaultPreferences => ({
  ...prefs,
  recentVaults: [...prefs.recentVaults],
  expandedFolders: { ...prefs.expandedFolders },
  hotkeys: { ...prefs.hotkeys },
  penPresets: prefs.penPresets.map((p) => ({ ...p })),
  ...cloneToolStyles(prefs),
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

const listeners = new Set<() => void>();

/** Called after every preference change (any storage mode); returns unsubscribe. */
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const notifyPreferences = () => {
  for (const listener of [...listeners]) {
    listener();
  }
};

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
  notifyPreferences();
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
    return clonePreferences(DEFAULT_PREFERENCES);
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
    notifyPreferences();
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
  notifyPreferences();
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
