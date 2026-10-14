/**
 * Every row in Settings, declared once. The sidebar, the pages and the
 * search all read this list; the controls themselves live in
 * `pages/*.tsx`, keyed by the same `id`.
 *
 * Pure data (no React) so tests and later phases (hotkeys, per-vault
 * settings) can import it without rendering anything.
 */

export type SettingsPageId =
  | "general"
  | "appearance"
  | "interface"
  | "drawing"
  | "pens"
  | "files"
  | "hotkeys";

export interface SettingsPage {
  id: SettingsPageId;
  label: string;
  /** Sidebar group heading (Obsidian's "Options"). */
  group: string;
}

/**
 * Sidebar order. A page with no available settings is not shown; Hotkeys is
 * a custom page backed by the single "hotkeys-list" row.
 */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: "general", label: "General", group: "Options" },
  { id: "appearance", label: "Appearance", group: "Options" },
  { id: "interface", label: "Interface", group: "Options" },
  { id: "drawing", label: "Drawing", group: "Options" },
  { id: "pens", label: "Pens & laser", group: "Options" },
  { id: "files", label: "Files", group: "Options" },
  { id: "hotkeys", label: "Hotkeys", group: "Options" },
];

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = "appearance";

export interface SettingSchema {
  id: string;
  page: SettingsPageId;
  label: string;
  /** Static description: shown on the row and matched by search. */
  description: string;
  /** Extra search terms (synonyms, config keys, old tab names). */
  keywords: readonly string[];
  /** Dotted config.toml key, when the setting is stored there. */
  configKey?: string;
  /** Can be overridden per vault (shows the "This vault" badge). */
  perVault?: boolean;
}

export const SETTINGS_SCHEMA: readonly SettingSchema[] = [
  // ---- General ----
  {
    id: "config-file",
    page: "general",
    label: "Config File",
    description:
      "Settings live in a plain text file you can edit by hand; changes apply live.",
    keywords: ["config.toml", "toml", "reload", "open config folder", "file"],
  },
  {
    id: "about",
    page: "general",
    label: "About Excalidraw Vault",
    description:
      "Your vault is an ordinary folder stored on your local hard drive. Drawings are standard .excalidraw JSON files with atomic writes, crash recovery store, and complete offline privacy. Zero network tracking, zero accounts, zero lock-in.",
    keywords: ["version", "offline", "privacy", "private", "local", "info"],
  },

  // ---- Appearance ----
  {
    id: "mode",
    page: "appearance",
    label: "Mode",
    description: "Light, dark, or follow the system appearance.",
    keywords: ["dark", "light", "system", "theme", "colour scheme", "color"],
    configKey: "appearance.mode",
  },
  {
    id: "colour-theme",
    page: "appearance",
    label: "Colour Theme",
    description:
      "Colours for the whole app. Every theme works in light and dark mode.",
    keywords: ["color", "theme", "palette", "noctalia", "skin"],
    configKey: "appearance.theme",
  },
  {
    id: "sync-canvas",
    page: "appearance",
    label: "Sync canvas with theme",
    description:
      "Shows the canvas and palette colours in the theme's colours. On screen only: files and exports keep standard colours.",
    keywords: ["canvas", "colour", "color", "theme", "match"],
    configKey: "appearance.sync_canvas",
  },
  {
    id: "canvas-background",
    page: "appearance",
    label: "Default Canvas Background",
    description: "Background color applied to newly created drawings.",
    keywords: ["canvas", "background", "colour", "color", "new drawing"],
    configKey: "appearance.canvas_background",
  },
  {
    id: "themes-folder",
    page: "appearance",
    label: "Themes Folder",
    description:
      "Drop Noctalia palettes (.json) here; they appear above automatically.",
    keywords: ["theme", "folder", "noctalia", "json", "custom", "import"],
  },

  {
    id: "accent-colour",
    page: "appearance",
    label: "Accent Colour",
    description:
      "Overrides the theme's primary colour. Leave unset to use the theme's own.",
    keywords: ["accent", "colour", "color", "primary", "highlight", "brand"],
    configKey: "appearance.accent_color",
  },

  // ---- Interface ----
  {
    id: "interface-zoom",
    page: "interface",
    label: "Interface Zoom",
    description: "Scales the whole window. Cmd+Shift +/- and 0 also work.",
    keywords: ["zoom", "scale", "magnify", "size", "cmd shift plus minus"],
    configKey: "interface.zoom",
  },
  {
    id: "show-tag-chips",
    page: "interface",
    label: "Show tag chips in the file tree",
    description: "Show a drawing's #tags as small chips after its name.",
    keywords: ["tag", "tags", "chip", "label", "navigator", "tree", "hashtag"],
    configKey: "interface.show_tag_chips",
  },
  {
    id: "sort-order",
    page: "interface",
    label: "Navigator Sort Order",
    description: "How folders and drawings are ordered in the file navigator.",
    keywords: [
      "sort",
      "order",
      "name",
      "modified",
      "navigator",
      "files",
      "a-z",
    ],
    configKey: "navigator.sort",
    perVault: true,
  },

  // ---- Drawing ----
  {
    id: "font-family",
    page: "drawing",
    label: "Default Font Family",
    description: "Font used when typing text in new drawings.",
    keywords: ["font", "text", "typeface", "excalifont", "drawing defaults"],
    configKey: "editor.font_family",
  },
  {
    id: "font-size",
    page: "drawing",
    label: "Default Font Size",
    description: "Initial text size for new text elements.",
    keywords: ["font", "text", "size", "drawing defaults"],
    configKey: "editor.font_size",
  },
  {
    id: "stroke-color",
    page: "drawing",
    label: "Default Stroke Color",
    description: "Primary line and shape outline color.",
    keywords: ["colour", "line", "outline", "stroke", "drawing defaults"],
    configKey: "editor.stroke_color",
  },
  {
    id: "background-fill",
    page: "drawing",
    label: "Default Background Fill",
    description: "Shape interior fill color.",
    keywords: ["colour", "fill", "background", "shape", "drawing defaults"],
    configKey: "editor.background_color",
  },
  {
    id: "fill-style",
    page: "drawing",
    label: "Default Fill Style",
    description: "Shading and texture pattern for shape backgrounds.",
    keywords: ["hachure", "cross-hatch", "solid", "fill", "drawing defaults"],
    configKey: "editor.fill_style",
  },
  {
    id: "stroke-width",
    page: "drawing",
    label: "Default Stroke Width",
    description: "Line thickness for shapes, lines, and arrows.",
    keywords: ["thickness", "line", "thin", "bold", "drawing defaults"],
    configKey: "editor.stroke_width",
  },
  {
    id: "roughness",
    page: "drawing",
    label: "Default Roughness",
    description: "Hand-drawn sketch intensity.",
    keywords: ["sloppiness", "architect", "artist", "cartoonist", "sketch"],
    configKey: "editor.roughness",
  },

  // ---- Pens & laser ----
  {
    id: "pen-presets",
    page: "pens",
    label: "Pen Presets",
    description:
      "Saved pens for freehand drawing. Select one from the pen bar or with Alt+1 to Alt+9 (change these keys on the Hotkeys page).",
    keywords: [
      "pen",
      "pens",
      "highlighter",
      "marker",
      "brush",
      "pressure",
      "smoothing",
      "opacity",
      "freedraw",
      "Alt+1",
    ],
    configKey: "pens.presets",
  },
  {
    id: "laser-color",
    page: "pens",
    label: "Laser Colour",
    description: "Colour of the laser pointer trail.",
    keywords: ["laser", "pointer", "trail", "presentation", "color", "colour"],
    configKey: "laser.color",
  },
  {
    id: "laser-size",
    page: "pens",
    label: "Laser Size",
    description: "Thickness of the laser pointer trail in pixels.",
    keywords: ["laser", "pointer", "trail", "presentation", "thickness"],
    configKey: "laser.size",
  },
  {
    id: "laser-fade",
    page: "pens",
    label: "Laser Fade Time",
    description: "How long the laser trail takes to fade out, in milliseconds.",
    keywords: ["laser", "pointer", "trail", "presentation", "decay", "ms"],
    configKey: "laser.decay_ms",
  },
  {
    id: "laser-length",
    page: "pens",
    label: "Laser Tail Length",
    description: "Number of trail points over which the tail tapers off.",
    keywords: ["laser", "pointer", "trail", "presentation", "tail"],
    configKey: "laser.length",
  },

  // ---- Files ----
  {
    id: "vault-folder",
    page: "files",
    label: "Current Vault Folder",
    description: "Where the open vault lives on disk.",
    keywords: ["vault", "folder", "path", "reveal", "storage", "location"],
  },
  {
    id: "autosave",
    page: "files",
    label: "Autosave Debounce Interval",
    description:
      "Time to wait after last drawing edit before writing atomically to disk.",
    keywords: ["save", "autosave", "delay", "debounce", "ms", "storage"],
    configKey: "saving.autosave_delay_ms",
  },
  {
    id: "confirm-delete",
    page: "files",
    label: "Confirm before delete",
    description: "Ask before moving a drawing or folder to the Trash.",
    keywords: ["delete", "trash", "confirm", "ask", "dialog"],
    configKey: "files.confirm_delete",
  },
  {
    id: "new-drawing-folder",
    page: "files",
    label: "Default Folder for New Drawings",
    description: "Vault folder where new drawings are created.",
    keywords: ["default folder", "location", "new drawing", "inbox", "folder"],
    configKey: "files.new_drawing_folder",
    perVault: true,
  },
  {
    id: "templates-folder",
    page: "files",
    label: "Templates Folder",
    description:
      "Vault folder holding your templates. Global templates live in the config folder.",
    keywords: ["templates", "template", "folder", "location"],
    configKey: "files.templates_folder",
    perVault: true,
  },

  // ---- Hotkeys ----
  {
    id: "hotkeys-list",
    page: "hotkeys",
    label: "Hotkeys",
    description:
      "Assign keyboard shortcuts to commands; changes are saved to [hotkeys] in config.toml.",
    keywords: ["shortcuts", "keyboard", "keybindings", "keys", "commands"],
  },
];

const BY_ID = new Map(SETTINGS_SCHEMA.map((s) => [s.id, s]));

export const getSettingSchema = (id: string): SettingSchema => {
  const schema = BY_ID.get(id);
  if (!schema) {
    throw new Error(`Unknown setting "${id}"`);
  }
  return schema;
};

export const getPage = (id: SettingsPageId): SettingsPage =>
  SETTINGS_PAGES.find((p) => p.id === id)!;

export const settingsForPage = (
  page: SettingsPageId,
  schema: readonly SettingSchema[] = SETTINGS_SCHEMA,
): SettingSchema[] => schema.filter((s) => s.page === page);

const haystack = (s: SettingSchema) =>
  [s.label, s.description, ...s.keywords, s.configKey ?? ""]
    .join("\n")
    .toLocaleLowerCase();

/**
 * Settings whose label, description, keywords or config key contain every
 * word of the query (case-insensitive). Empty query -> no results.
 * Results keep schema order, which is page order then row order.
 */
export const searchSettings = (
  query: string,
  schema: readonly SettingSchema[] = SETTINGS_SCHEMA,
): SettingSchema[] => {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [];
  }
  return schema.filter((s) => {
    const text = haystack(s);
    return words.every((w) => text.includes(w));
  });
};

/** Search results grouped by page, in sidebar order. */
export const groupByPage = (
  results: readonly SettingSchema[],
): { page: SettingsPage; settings: SettingSchema[] }[] =>
  SETTINGS_PAGES.map((page) => ({
    page,
    settings: results.filter((s) => s.page === page.id),
  })).filter((g) => g.settings.length > 0);
