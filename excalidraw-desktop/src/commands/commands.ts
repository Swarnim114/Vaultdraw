/**
 * The v1 command registry: pure metadata, no handlers (the app shell binds
 * those). Order matters: it is the dispatcher's tie-break and the order the
 * Hotkeys page lists commands in.
 */
import type { Chord, CommandDefinition, Platform } from "./types";

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
    title: "Search drawings",
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
    id: "palette.quickSwitcher",
    title: "Quick switcher",
    category: "Palette",
    keys: { default: ["Mod+P"] },
    when: ["vaultOpen", "!modalOpen"],
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
    title: "New drawing from template",
    category: "Vault",
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
    title: "Open hotkey settings",
    category: "Settings",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
];

const BY_ID: ReadonlyMap<string, CommandDefinition> = new Map(
  COMMANDS.map((command) => [command.id, command]),
);

export const getCommand = (id: string): CommandDefinition | undefined =>
  BY_ID.get(id);

export const isCommandId = (id: string): boolean => BY_ID.has(id);

/** Default chords on a platform ([] = unassigned). */
export const defaultKeys = (
  command: CommandDefinition,
  platform: Platform,
): Chord[] => command.keys[platform] ?? command.keys.default;
