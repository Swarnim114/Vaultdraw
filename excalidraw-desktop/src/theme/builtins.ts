/**
 * Built-in themes, loaded lazily.
 *
 * The JSON files are bundled eagerly (they are small), but parsing and
 * deriving a theme (parseThemeFile) only happens when that theme is used:
 * selected, explicitly requested, or rendered by the old full-theme API.
 * Lists and pickers use the cheap `builtinThemeSummaries()` previews.
 *
 * Sources, highest priority first when two files share a slug:
 *   1. builtin/noctalia/   Noctalia's own palettes (MIT, see NOTICE)
 *   2. builtin/community/  Noctalia community palettes (see SOURCE.md)
 *   3. builtin/*.json      Vaultdraw's own (Default)
 * Order: Default first, then by name.
 */

import { contrastRatio, ensureContrast, normalizeHex } from "./color";
import { parseThemeFile, slugify } from "./normalize";
import { THEME_MODES } from "./types";

import type { ResolvedTheme, ThemeMode, ThemeVariant } from "./types";

export const DEFAULT_THEME_ID = "default";

export type BuiltinOrigin = "noctalia" | "community" | "vaultdraw";

const ORIGIN_PRIORITY: Record<BuiltinOrigin, number> = {
  noctalia: 0,
  community: 1,
  vaultdraw: 2,
};

const GLOBS: Record<BuiltinOrigin, Record<string, unknown>> = {
  noctalia: import.meta.glob("./builtin/noctalia/*.json", {
    eager: true,
    import: "default",
  }),
  community: import.meta.glob("./builtin/community/*.json", {
    eager: true,
    import: "default",
  }),
  vaultdraw: import.meta.glob("./builtin/*.json", {
    eager: true,
    import: "default",
  }),
};

export interface BuiltinThemeFile {
  id: string;
  name: string;
  author?: string;
  origin: BuiltinOrigin;
  /** Bundle path, e.g. "./builtin/noctalia/nord.json". */
  path: string;
  json: unknown;
}

/** Colours a theme card needs, per mode (lowercase `#rrggbb`). */
export interface ThemePreviewColors {
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  primary: string;
  terminal: { red: string; yellow: string; green: string; blue: string };
}

export interface ThemePreview {
  dark: ThemePreviewColors;
  light: ThemePreviewColors;
  /** True for a mode the file doesn't provide (generated from the other). */
  generated: { dark: boolean; light: boolean };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fileStem = (path: string) =>
  path.replace(/^.*\//, "").replace(/\.json$/i, "");

let files: BuiltinThemeFile[] | null = null;

/** Every built-in file, de-duplicated by slug, Default first then by name. No parsing. */
export const builtinThemeFiles = (): readonly BuiltinThemeFile[] => {
  if (files) {
    return files;
  }
  const byId = new Map<string, BuiltinThemeFile>();
  for (const origin of Object.keys(GLOBS) as BuiltinOrigin[]) {
    for (const [path, json] of Object.entries(GLOBS[origin])) {
      const raw = isPlainObject(json) ? json : {};
      const name =
        typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : fileStem(path);
      const id = slugify(name);
      const prev = byId.get(id);
      if (prev && ORIGIN_PRIORITY[prev.origin] <= ORIGIN_PRIORITY[origin]) {
        continue;
      }
      byId.set(id, {
        id,
        name,
        ...(typeof raw.author === "string" && raw.author.trim()
          ? { author: raw.author.trim() }
          : {}),
        origin,
        path,
        json,
      });
    }
  }
  files = [...byId.values()].sort((a, b) =>
    a.id === DEFAULT_THEME_ID
      ? -1
      : b.id === DEFAULT_THEME_ID
      ? 1
      : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return files;
};

const resolvedCache = new Map<string, ResolvedTheme>();

/** Parses (once) and returns one built-in theme by id; null when unknown. */
export const getBuiltinTheme = (id: string): ResolvedTheme | null => {
  const hit = resolvedCache.get(id);
  if (hit) {
    return hit;
  }
  const file = builtinThemeFiles().find((f) => f.id === id);
  if (!file) {
    return null;
  }
  const theme = parseThemeFile(file.json, file.name);
  resolvedCache.set(id, theme);
  return theme;
};

/** Number of built-ins parsed so far (tests / diagnostics). */
export const parsedBuiltinCount = () => resolvedCache.size;

let allCache: ResolvedTheme[] | null = null;

/**
 * Parses (once) and returns every built-in theme, Default first.
 * Expensive with 100+ themes: prefer builtinThemeSummaries() / getBuiltinTheme().
 */
export const loadBuiltinThemes = (): ResolvedTheme[] => {
  if (!allCache) {
    allCache = builtinThemeFiles().map(
      (f) => getBuiltinTheme(f.id) as ResolvedTheme,
    );
  }
  return allCache;
};

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

/** Preview colours of a resolved variant. */
export const previewFromVariant = (v: ThemeVariant): ThemePreviewColors => ({
  surface: v.mSurface,
  onSurface: v.mOnSurface,
  surfaceVariant: v.mSurfaceVariant,
  onSurfaceVariant: v.mOnSurfaceVariant,
  outline: v.mOutline,
  primary: v.mPrimary,
  terminal: {
    red: v.terminal.normal.red,
    yellow: v.terminal.normal.yellow,
    green: v.terminal.normal.green,
    blue: v.terminal.normal.blue,
  },
});

export const previewFromTheme = (theme: ResolvedTheme): ThemePreview => ({
  dark: previewFromVariant(theme.dark),
  light: previewFromVariant(theme.light),
  generated: { ...theme.generated },
});

/** Same surface rule as normalize.ts (fixSurface); cheap. */
const SURFACE_HEADROOM = 9;
const previewSurface = (surface: string, mode: ThemeMode) => {
  const extreme = mode === "dark" ? "#ffffff" : "#000000";
  return contrastRatio(extreme, surface) >= SURFACE_HEADROOM
    ? surface
    : ensureContrast(surface, extreme, SURFACE_HEADROOM);
};

/**
 * Reads the preview straight from a complete variant block (no derivation).
 * Returns null when anything needed is missing or invalid; the caller then
 * resolves the theme properly.
 */
const rawPreview = (
  raw: unknown,
  mode: ThemeMode,
): ThemePreviewColors | null => {
  if (!isPlainObject(raw)) {
    return null;
  }
  const hex = (v: unknown) => (typeof v === "string" ? normalizeHex(v) : null);
  const term = isPlainObject(raw.terminal) ? raw.terminal : {};
  const normal = isPlainObject(term.normal) ? term.normal : {};
  const values = {
    surface: hex(raw.mSurface),
    onSurface: hex(raw.mOnSurface),
    surfaceVariant: hex(raw.mSurfaceVariant),
    onSurfaceVariant: hex(raw.mOnSurfaceVariant),
    outline: hex(raw.mOutline),
    primary: hex(raw.mPrimary),
    red: hex(normal.red),
    yellow: hex(normal.yellow),
    green: hex(normal.green),
    blue: hex(normal.blue),
  };
  if (Object.values(values).some((v) => v === null)) {
    return null;
  }
  const v = values as Record<keyof typeof values, string>;
  return {
    surface: previewSurface(v.surface, mode),
    onSurface: v.onSurface,
    surfaceVariant: v.surfaceVariant,
    onSurfaceVariant: v.onSurfaceVariant,
    outline: v.outline,
    primary: v.primary,
    terminal: { red: v.red, yellow: v.yellow, green: v.green, blue: v.blue },
  };
};

const previewCache = new Map<string, ThemePreview>();

/** Cheap preview of a built-in: read from the JSON, resolved only if incomplete. */
export const builtinThemePreview = (id: string): ThemePreview | null => {
  const hit = previewCache.get(id);
  if (hit) {
    return hit;
  }
  const file = builtinThemeFiles().find((f) => f.id === id);
  if (!file) {
    return null;
  }
  const json = isPlainObject(file.json) ? file.json : {};
  const modes = {} as Record<ThemeMode, ThemePreviewColors | null>;
  for (const mode of THEME_MODES) {
    modes[mode] = rawPreview(json[mode], mode);
  }
  const preview =
    modes.dark && modes.light
      ? {
          dark: modes.dark,
          light: modes.light,
          generated: { dark: false, light: false },
        }
      : previewFromTheme(getBuiltinTheme(id) as ResolvedTheme);
  previewCache.set(id, preview);
  return preview;
};

/** Clears every cache (tests / benchmarks). */
export const resetBuiltinCaches = () => {
  files = null;
  allCache = null;
  resolvedCache.clear();
  previewCache.clear();
};
