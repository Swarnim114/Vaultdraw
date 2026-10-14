/**
 * The v1 command registry: pure metadata, no handlers (the app shell binds
 * those). Order matters: it is the dispatcher's tie-break and the order the
 * Hotkeys page lists commands in.
 */
import { SETTINGS_PAGES } from "../components/settings/schema";
import { MAX_PEN_PRESETS } from "../pens/penPresets";
import { SORT_LABELS, SORT_ORDERS, type SortOrder } from "../vault/sortOrder";

import { EDITOR_COMMANDS } from "./editorCommands";

import type { Chord, CommandDefinition, Platform } from "./types";

/** The palette's two modes (VS Code style): Cmd+P files, Cmd+Shift+P commands. */
export const PALETTE_FILES_ID = "palette.files";
export const PALETTE_COMMANDS_ID = "palette.commands";

/** "pen.select1" .. "pen.select9": pick a saved pen (and the freedraw tool). */
export const penCommandId = (index: number) => `pen.select${index + 1}`;

const PEN_COMMANDS: CommandDefinition[] = Array.from(
  { length: MAX_PEN_PRESETS },
  (_, i) => ({
    id: penCommandId(i),
    title: `Select pen ${i + 1}`,
    category: "Pens",
    // Matched by code, so macOS Option+digit dead keys do not matter. Never
    // while typing: Option+digit types characters (¡, ™, £...) on macOS.
    keys: { default: [`Alt+${i + 1}`] },
    when: ["drawingOpen", "!textEditing", "!modalOpen"],
    palette: false,
  }),
);

/** "settings.page.appearance": open one settings page (Hotkeys has its own). */
export const settingsPageCommandId = (page: string) => `settings.page.${page}`;

const SETTINGS_PAGE_COMMANDS: CommandDefinition[] = SETTINGS_PAGES.filter(
  (page) => page.id !== "hotkeys",
).map((page) => ({
  id: settingsPageCommandId(page.id),
  title: `Settings: ${page.label}`,
  category: "Settings",
  keys: { default: [] },
  when: ["vaultOpen", "!modalOpen"],
}));

/** "navigator.sort.name_asc": set the navigator sort order. */
export const sortCommandId = (order: SortOrder) => `navigator.sort.${order}`;

const SORT_COMMANDS: CommandDefinition[] = SORT_ORDERS.map((order) => ({
  id: sortCommandId(order),
  title: `Sort: ${SORT_LABELS[order]}`,
  category: "Navigator",
  keys: { default: [] },
  when: ["vaultOpen", "!modalOpen"],
}));

export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: "file.save",
    title: "Save drawing",
    category: "File",
    // Mod+Shift+S too, so it never reaches Excalidraw's "Save to disk"
    // download. Ctrl aliases on macOS keep the old Cmd-or-Ctrl behaviour.
    keys: {
      default: ["Mod+S", "Mod+Shift+S"],
      mac: ["Mod+S", "Mod+Shift+S", "Ctrl+S"],
    },
    when: ["drawingOpen"],
  },
  {
    id: "settings.open",
    title: "Open settings",
    category: "Settings",
    keys: { default: ["Mod+Comma"], mac: ["Mod+Comma", "Ctrl+Comma"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "navigator.focusSearch",
    title: "Search vault",
    category: "Navigator",
    keys: { default: ["Mod+Shift+F"], mac: ["Mod+Shift+F", "Ctrl+Shift+F"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "view.zoomIn",
    title: "Zoom in (interface)",
    category: "View",
    keys: { default: ["Mod+Shift+Equal", "Mod+Shift+NumpadAdd"] },
    repeat: true,
  },
  {
    id: "view.zoomOut",
    title: "Zoom out (interface)",
    category: "View",
    keys: { default: ["Mod+Shift+Minus", "Mod+Shift+NumpadSubtract"] },
    repeat: true,
  },
  {
    id: "view.zoomReset",
    title: "Reset interface zoom",
    category: "View",
    keys: { default: ["Mod+Shift+0", "Mod+Shift+Numpad0"] },
  },
  {
    id: PALETTE_FILES_ID,
    title: "Go to drawing",
    category: "Palette",
    keys: { default: ["Mod+P"] },
    when: ["vaultOpen", "!modalOpen"],
    // F41's single palette id: an existing `[hotkeys]` entry keeps working
    // (it was the Cmd+P key); the chords that now belong to the commands
    // mode by default are dropped from it.
    legacy: {
      id: "palette.quickSwitcher",
      except: ["Mod+Slash", "Mod+Shift+P"],
    },
  },
  {
    id: PALETTE_COMMANDS_ID,
    title: "Show all commands",
    category: "Palette",
    // VS Code's Mod+Shift+P, and Excalidraw's own palette key (Mod+/).
    keys: { default: ["Mod+Shift+P", "Mod+Slash"] },
    when: ["vaultOpen", "!modalOpen"],
    // Already in commands mode; "Go to drawing" is listed to switch.
    palette: false,
  },
  {
    id: "vault.newDrawing",
    title: "New drawing",
    category: "Vault",
    keys: { default: ["Mod+N"] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  {
    id: "vault.newFromTemplate",
    title: "Templates: New drawing from template",
    category: "Templates",
    // Matched by code: Option+N types a dead key on macOS.
    keys: { default: ["Mod+Alt+N"], mac: ["Mod+Alt+N", "Ctrl+Alt+N"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "view.toggleNavigator",
    title: "Toggle navigator",
    category: "Navigator",
    keys: { default: ["Mod+Backslash"] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "vault.switch",
    title: "Open another vault",
    category: "Vault",
    keys: { default: [] },
    when: ["!modalOpen"],
  },
  {
    id: "file.revealInFinder",
    title: "Reveal drawing in Finder",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "file.duplicate",
    title: "Duplicate drawing",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable"],
  },
  {
    id: "appearance.toggleMode",
    title: "Toggle light/dark mode",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "settings.openHotkeys",
    title: "Settings: Hotkeys",
    category: "Settings",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  ...SETTINGS_PAGE_COMMANDS,
  {
    id: "appearance.mode.light",
    title: "Mode: Light",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.mode.dark",
    title: "Mode: Dark",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.mode.system",
    title: "Mode: System",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.syncCanvas.on",
    title: "Sync canvas with theme: On",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "appearance.syncCanvas.off",
    title: "Sync canvas with theme: Off",
    category: "Appearance",
    keys: { default: [] },
  },
  {
    id: "file.exportPng",
    title: "Export: PNG",
    category: "Export",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "file.exportSvg",
    title: "Export: SVG",
    category: "Export",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "file.saveCopy",
    title: "Save a copy",
    category: "Export",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "templates.saveDrawing",
    title: "Templates: Save drawing as template",
    category: "Templates",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
  {
    id: "navigator.searchTags",
    title: "Tags: Search by tag",
    category: "Tags",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "navigator.newFolder",
    title: "New folder",
    category: "Navigator",
    keys: { default: [] },
    when: ["vaultOpen", "writable", "!modalOpen"],
  },
  {
    id: "file.rename",
    title: "Rename drawing",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
  {
    id: "file.move",
    title: "Move drawing",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
  {
    id: "file.trash",
    title: "Move drawing to Trash",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "writable", "!modalOpen"],
  },
  {
    id: "vault.reveal",
    title: "Reveal vault folder",
    category: "Vault",
    keys: { default: [] },
    when: ["vaultOpen"],
  },
  {
    id: "vault.openRecovered",
    title: "Open recovered drawings",
    category: "Vault",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: "file.resolveConflict",
    title: "Resolve conflict",
    category: "File",
    keys: { default: [] },
    when: ["drawingOpen", "!modalOpen"],
  },
  ...SORT_COMMANDS,
  ...EDITOR_COMMANDS,
  ...PEN_COMMANDS,
];

const BY_ID: ReadonlyMap<string, CommandDefinition> = new Map(
  COMMANDS.map((command) => [command.id, command]),
);

export const getCommand = (id: string): CommandDefinition | undefined =>
  BY_ID.get(id);

/** Older ids still accepted in `[hotkeys]` (see CommandDefinition.legacy). */
const LEGACY_IDS: ReadonlySet<string> = new Set(
  COMMANDS.flatMap((command) => (command.legacy ? [command.legacy.id] : [])),
);

export const isCommandId = (id: string): boolean =>
  BY_ID.has(id) || LEGACY_IDS.has(id);

/** Default chords on a platform ([] = unassigned). */
export const defaultKeys = (
  command: CommandDefinition,
  platform: Platform,
): Chord[] => command.keys[platform] ?? command.keys.default;
