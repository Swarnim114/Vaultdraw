/**
 * Theme registry: the built-in themes plus the user's theme files from
 * `<config dir>/themes/` (Tauri `list_themes`).
 *
 * Rules (personal/planning/themes.md, "Final decisions"):
 * - A theme is selected by its file/folder name (built-ins: their name),
 *   case-insensitively; its id/slug and JSON `name` also match.
 * - A user theme overrides a built-in with the same name.
 * - `themes/X.json` and `themes/X/X.json` both present: the folder wins and
 *   a warning is reported.
 * - An unknown or broken selected theme falls back to Default with a problem.
 *
 * In a plain browser (Playwright harness, tests) only built-ins exist.
 */

import { isTauriAvailable } from "../vault/DesktopVaultRepository";

import { parseThemeFile, slugify } from "./normalize";

import { DEFAULT_THEME_ID, loadBuiltinThemes } from "./index";

import type { ResolvedTheme } from "./types";

/** One row of the Rust `list_themes` result. */
export interface ThemeListingEntry {
  id: string;
  path: string;
  json: string | null;
  error: string | null;
}

export interface ThemeEntry {
  /** Value stored in `appearance.theme`: built-in name or user file id. */
  key: string;
  theme: ResolvedTheme;
  source: "builtin" | "user";
  /** Theme file on disk (user themes only). */
  path: string | null;
  /** Problems worth showing (user themes only; built-in notes are hidden). */
  warnings: string[];
  /** True when this user theme replaces a built-in of the same name. */
  overridesBuiltin: boolean;
}

export interface ThemeFileProblem {
  id: string;
  path: string;
  kind: "error" | "warning";
  message: string;
}

export interface ThemeRegistry {
  mode: "tauri" | "browser";
  themes: ThemeEntry[];
  /** Files that could not be loaded, and folder/file clashes. */
  fileProblems: ThemeFileProblem[];
  /** list_themes itself failed (folder unreadable…). */
  loadError: string | null;
}

export interface ResolvedSelection {
  entry: ThemeEntry;
  /** Set when the selected theme is unknown or broken and Default is used. */
  problem: string | null;
}

const lower = (s: string) => s.trim().toLowerCase();

const builtinEntries = (): ThemeEntry[] =>
  loadBuiltinThemes().map((theme) => ({
    key: theme.name,
    theme,
    source: "builtin",
    path: null,
    warnings: [],
    overridesBuiltin: false,
  }));

const sameName = (entry: ThemeEntry, id: string) => {
  const q = lower(id);
  return (
    lower(entry.key) === q ||
    lower(entry.theme.name) === q ||
    entry.theme.id === slugify(id)
  );
};

const segments = (path: string) => path.split(/[\\/]+/).filter(Boolean).length;

/** Registry with the built-in themes only. */
export const builtinRegistry = (
  mode: ThemeRegistry["mode"] = "browser",
): ThemeRegistry => ({
  mode,
  themes: builtinEntries(),
  fileProblems: [],
  loadError: null,
});

const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message
    : err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);

/** Builds the registry from a `list_themes` result (pure; unit tested). */
export const buildThemeRegistry = (
  listing: readonly ThemeListingEntry[],
  mode: ThemeRegistry["mode"] = "tauri",
): ThemeRegistry => {
  const fileProblems: ThemeFileProblem[] = [];

  // 1. Group by id (case-insensitive); the folder layout (deeper path) wins.
  const byId = new Map<string, ThemeListingEntry[]>();
  for (const item of listing) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) {
      continue;
    }
    const key = lower(item.id);
    byId.set(key, [...(byId.get(key) ?? []), item]);
  }
  const chosen: ThemeListingEntry[] = [];
  for (const items of byId.values()) {
    const sorted = [...items].sort(
      (a, b) => segments(b.path) - segments(a.path),
    );
    const [winner, ...losers] = sorted;
    chosen.push(winner);
    for (const loser of losers) {
      fileProblems.push({
        id: winner.id,
        path: loser.path,
        kind: "warning",
        message: `Both themes/${loser.id}.json and the folder themes/${winner.id}/ exist; using the folder`,
      });
    }
  }

  // 2. Parse.
  const userEntries: ThemeEntry[] = [];
  for (const item of chosen) {
    if (item.error || item.json == null) {
      fileProblems.push({
        id: item.id,
        path: item.path,
        kind: "error",
        message: item.error ?? `${item.id}: the theme file could not be read`,
      });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(item.json);
    } catch (err) {
      fileProblems.push({
        id: item.id,
        path: item.path,
        kind: "error",
        message: `Theme "${item.id}": not valid JSON (${errorText(err)})`,
      });
      continue;
    }
    try {
      const theme = parseThemeFile(json, item.id);
      userEntries.push({
        key: item.id,
        theme,
        source: "user",
        path: item.path,
        warnings: theme.warnings,
        overridesBuiltin: false,
      });
    } catch (err) {
      fileProblems.push({
        id: item.id,
        path: item.path,
        kind: "error",
        message: errorText(err),
      });
    }
  }

  // 3. Merge: user themes replace built-ins in place, others are appended
  //    (sorted by name).
  const themes = builtinEntries();
  const extra: ThemeEntry[] = [];
  for (const entry of userEntries) {
    const index = themes.findIndex(
      (b) => b.source === "builtin" && sameName(b, entry.key),
    );
    if (index >= 0) {
      themes[index] = { ...entry, overridesBuiltin: true };
    } else {
      extra.push(entry);
    }
  }
  extra.sort((a, b) =>
    a.theme.name.localeCompare(b.theme.name, undefined, {
      sensitivity: "base",
    }),
  );
  return { mode, themes: [...themes, ...extra], fileProblems, loadError: null };
};

/** Finds a theme by key, name or slug (case-insensitive). */
export const findTheme = (
  registry: ThemeRegistry,
  name: string,
): ThemeEntry | null => {
  const q = lower(name);
  if (!q) {
    return null;
  }
  return (
    registry.themes.find((e) => lower(e.key) === q) ??
    registry.themes.find((e) => lower(e.theme.name) === q) ??
    registry.themes.find((e) => e.theme.id === slugify(name)) ??
    null
  );
};

export const getDefaultEntry = (registry: ThemeRegistry): ThemeEntry =>
  registry.themes.find(
    (e) => e.source === "builtin" && e.theme.id === DEFAULT_THEME_ID,
  ) ??
  findTheme(registry, "Default") ??
  builtinEntries()[0];

/** True when the entry is the stock Default look (no tokens applied). */
export const isStockDefault = (entry: ThemeEntry) =>
  entry.source === "builtin" && entry.theme.id === DEFAULT_THEME_ID;

/** The theme to use for a selected name, falling back to Default. */
export const resolveSelectedTheme = (
  registry: ThemeRegistry,
  selected: string,
): ResolvedSelection => {
  const found = findTheme(registry, selected);
  if (found) {
    return { entry: found, problem: null };
  }
  const fallback = getDefaultEntry(registry);
  const broken = registry.fileProblems.find(
    (p) => p.kind === "error" && lower(p.id) === lower(selected),
  );
  return {
    entry: fallback,
    problem: broken
      ? `Theme "${selected}" could not be loaded: ${broken.message}. Using ${fallback.theme.name}.`
      : `Theme "${selected}" was not found in the themes folder. Using ${fallback.theme.name}.`,
  };
};

// ---------------------------------------------------------------------------
// Runtime (Tauri): load, cache and live reload
// ---------------------------------------------------------------------------

export type ThemeInvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type ThemeListenFn = <T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export interface ThemeRegistryDeps {
  invoke?: ThemeInvokeFn;
  listen?: ThemeListenFn;
  /** Force Tauri mode (tests). Defaults to isTauriAvailable(win). */
  tauri?: boolean;
}

/** Fired on window when the registry was reloaded. detail = registry. */
export const THEMES_CHANGED_EVENT = "vault-themes-changed";

let cached: ThemeRegistry | null = null;

export const getThemeRegistry = (): ThemeRegistry =>
  cached ?? builtinRegistry();

/** Replaces the cached registry (tests, reloads). */
export const setThemeRegistry = (registry: ThemeRegistry | null) => {
  cached = registry;
};

const getInvoke = async (deps: ThemeRegistryDeps): Promise<ThemeInvokeFn> =>
  deps.invoke ??
  ((await import("@tauri-apps/api/core")).invoke as ThemeInvokeFn);

/**
 * Loads built-ins + user themes and caches the result. Never throws: a
 * failing `list_themes` keeps the built-ins and reports `loadError`.
 */
export const loadThemeRegistry = async (
  win: Window | null | undefined,
  deps: ThemeRegistryDeps = {},
): Promise<ThemeRegistry> => {
  const useTauri = deps.tauri ?? isTauriAvailable(win);
  if (!useTauri) {
    cached = builtinRegistry("browser");
    return cached;
  }
  try {
    const invoke = await getInvoke(deps);
    const listing = await invoke<ThemeListingEntry[]>("list_themes");
    cached = buildThemeRegistry(Array.isArray(listing) ? listing : [], "tauri");
  } catch (err) {
    cached = {
      ...builtinRegistry("tauri"),
      loadError: `Could not read the themes folder: ${errorText(err)}`,
    };
  }
  return cached;
};

const touchesThemes = (paths: unknown) =>
  !Array.isArray(paths) ||
  paths.length === 0 ||
  paths.some((p) => typeof p === "string" && /[\\/]themes([\\/]|$)/i.test(p));

/**
 * Reloads the registry whenever the config watcher reports a change inside
 * themes/, then dispatches THEMES_CHANGED_EVENT on `win`. Returns a disposer.
 * No-op outside Tauri.
 */
export const watchThemeRegistry = (
  win: Window,
  deps: ThemeRegistryDeps = {},
): (() => void) => {
  const useTauri = deps.tauri ?? isTauriAvailable(win);
  if (!useTauri) {
    return () => {};
  }
  let disposed = false;
  let unlisten: (() => void) | null = null;
  let reloading: Promise<unknown> = Promise.resolve();
  const reload = () => {
    reloading = reloading.then(async () => {
      if (disposed) {
        return;
      }
      const registry = await loadThemeRegistry(win, deps);
      if (!disposed) {
        const EventCtor =
          (win as Window & { CustomEvent?: typeof CustomEvent }).CustomEvent ??
          CustomEvent;
        win.dispatchEvent(
          new EventCtor(THEMES_CHANGED_EVENT, { detail: registry }),
        );
      }
    });
  };
  void (async () => {
    try {
      const listen =
        deps.listen ??
        ((await import("@tauri-apps/api/event"))
          .listen as unknown as ThemeListenFn);
      const off = await listen<{ paths?: string[] }>("config-change", (e) => {
        if (touchesThemes(e?.payload?.paths)) {
          reload();
        }
      });
      if (disposed) {
        off();
      } else {
        unlisten = off;
      }
    } catch {
      // No live reload; reopening Settings or restarting picks changes up.
    }
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
};

/** Reveal `<config dir>/themes/` in the file manager (Tauri only). */
export const openThemesDir = async (deps: ThemeRegistryDeps = {}) => {
  const invoke = await getInvoke(deps);
  await invoke("open_themes_dir");
};
