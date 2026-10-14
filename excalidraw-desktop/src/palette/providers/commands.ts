/** Palette provider: every command in the registry that can run right now. */
import { COMMANDS } from "../../commands/commands";
import { commandShortcutLabel } from "../shortcuts";

import type { CommandRunner } from "../../commands/useCommands";
import type { HotkeyOverrides } from "../../commands/types";
import type { PaletteItem, PaletteProvider } from "../types";

export interface CommandsProviderDeps {
  runner: Pick<CommandRunner, "run" | "isAvailable" | "platform">;
  /** Live `[hotkeys]` overrides (shortcut labels follow rebinds). */
  overrides(): HotkeyOverrides;
  /** The current choice in a family (mode, sync, sort); default none. */
  checked?(id: string): boolean;
}

export function createCommandsProvider({
  runner,
  overrides,
  checked,
}: CommandsProviderDeps): PaletteProvider {
  return {
    id: "commands",
    items(): PaletteItem[] {
      const live = overrides();
      const items: PaletteItem[] = [];
      for (const command of COMMANDS) {
        if (
          command.palette === false ||
          !runner.isAvailable(command.id, { fromPalette: true })
        ) {
          continue;
        }
        items.push({
          key: `command:${command.id}`,
          title: command.title,
          group: command.category,
          shortcut: commandShortcutLabel(command.id, live, runner.platform),
          ...(checked?.(command.id) ? { checked: true } : {}),
          run: () => {
            runner.run(command.id, { fromPalette: true });
          },
        });
      }
      return items;
    },
  };
}
