/**
 * Binds the app shell's actions to command ids (see commands.ts). Every id in
 * COMMANDS gets a handler here; the dispatcher decides when it may run.
 */
import {
  SETTINGS_PAGES,
  type SettingsPageId,
} from "../components/settings/schema";
import { PEN_COMMAND_HANDLERS } from "../pens/penCommands";
import { SORT_ORDERS, type SortOrder } from "../vault/sortOrder";

import { settingsPageCommandId, sortCommandId } from "./commands";

import type { PaletteMode } from "../palette/rank";
import type { CommandHandlers } from "./types";

export interface AppCommandActions {
  save(): void | Promise<void>;
  openSettings(): void;
  openHotkeySettings(): void;
  focusSearch(): void;
  zoom(command: "in" | "out" | "reset"): void;
  toggleNavigator(): void;
  newDrawing(): void | Promise<void>;
  newFromTemplate(): void | Promise<void>;
  switchVault(): void | Promise<void>;
  revealActive(): void | Promise<void>;
  duplicateActive(): void | Promise<void>;
  toggleMode(): void;
  /** Open the palette in `mode`; the same mode again closes it. */
  togglePalette(mode: PaletteMode): void;
  openSettingsPage(page: SettingsPageId): void;
  setMode(mode: "light" | "dark" | "system"): void;
  setSyncCanvas(on: boolean): void;
  exportActive(format: "png" | "svg" | "copy"): void | Promise<void>;
  saveActiveAsTemplate(): void;
  searchTags(): void;
  newFolder(): void;
  renameActive(): void;
  moveActive(): void;
  trashActive(): void;
  revealVault(): void | Promise<void>;
  setSort(order: SortOrder): void;
  /** Only while recovered snapshots exist: no handler = not offered. */
  openRecovered?: () => void;
  /** Only while the open drawing has a conflict. */
  resolveConflict?: () => void;
}

export function appCommandHandlers(
  actions: AppCommandActions,
): CommandHandlers {
  return {
    "file.save": actions.save,
    "settings.open": actions.openSettings,
    "settings.openHotkeys": actions.openHotkeySettings,
    "navigator.focusSearch": actions.focusSearch,
    "view.zoomIn": () => actions.zoom("in"),
    "view.zoomOut": () => actions.zoom("out"),
    "view.zoomReset": () => actions.zoom("reset"),
    "view.toggleNavigator": actions.toggleNavigator,
    "vault.newDrawing": actions.newDrawing,
    "vault.newFromTemplate": actions.newFromTemplate,
    "vault.switch": actions.switchVault,
    "file.revealInFinder": actions.revealActive,
    "file.duplicate": actions.duplicateActive,
    "appearance.toggleMode": actions.toggleMode,
    "palette.files": () => actions.togglePalette("files"),
    "palette.commands": () => actions.togglePalette("commands"),
    "appearance.mode.light": () => actions.setMode("light"),
    "appearance.mode.dark": () => actions.setMode("dark"),
    "appearance.mode.system": () => actions.setMode("system"),
    "appearance.syncCanvas.on": () => actions.setSyncCanvas(true),
    "appearance.syncCanvas.off": () => actions.setSyncCanvas(false),
    "file.exportPng": () => actions.exportActive("png"),
    "file.exportSvg": () => actions.exportActive("svg"),
    "file.saveCopy": () => actions.exportActive("copy"),
    "templates.saveDrawing": actions.saveActiveAsTemplate,
    "navigator.searchTags": actions.searchTags,
    "navigator.newFolder": actions.newFolder,
    "file.rename": actions.renameActive,
    "file.move": actions.moveActive,
    "file.trash": actions.trashActive,
    "vault.reveal": actions.revealVault,
    "vault.openRecovered": actions.openRecovered,
    "file.resolveConflict": actions.resolveConflict,
    ...Object.fromEntries(
      SETTINGS_PAGES.filter((page) => page.id !== "hotkeys").map((page) => [
        settingsPageCommandId(page.id),
        () => actions.openSettingsPage(page.id),
      ]),
    ),
    ...Object.fromEntries(
      SORT_ORDERS.map((order) => [
        sortCommandId(order),
        () => actions.setSort(order),
      ]),
    ),
    ...PEN_COMMAND_HANDLERS,
  };
}
