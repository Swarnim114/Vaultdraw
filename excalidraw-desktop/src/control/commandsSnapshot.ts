import { allCommands } from "../commands/commands";
import { effectiveKeys } from "../commands/keymap";

import type { HotkeyOverrides, Platform } from "../commands/types";

export interface CommandInfo {
  id: string;
  title: string;
  category: string;
  keys: string[];
  when: string[];
}

/** Every command with its effective chords (config form, [hotkeys] applied). */
export function commandInfos(
  overrides: HotkeyOverrides,
  platform: Platform,
): CommandInfo[] {
  return allCommands(overrides).map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    keys: effectiveKeys(c, overrides, platform),
    when: [...(c.when ?? [])],
  }));
}

/** Pushes the list to the native side, skipping a list it already has. */
export function createSnapshotSender(
  send: (commands: CommandInfo[]) => Promise<unknown>,
) {
  let last = "";
  return async (commands: CommandInfo[]): Promise<boolean> => {
    const key = JSON.stringify(commands);
    if (key === last) {
      return false;
    }
    last = key;
    try {
      await send(commands);
    } catch {
      last = ""; // retry on the next change
    }
    return true;
  };
}
