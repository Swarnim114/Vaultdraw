/**
 * Binds the app shell's actions to command ids (see commands.ts). Every id in
 * COMMANDS gets a handler here; the dispatcher decides when it may run.
 */
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
  toggleQuickSwitcher(): void;
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
    "palette.quickSwitcher": actions.toggleQuickSwitcher,
  };
}
