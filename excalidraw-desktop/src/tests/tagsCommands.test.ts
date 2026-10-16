import { describe, expect, it, vi } from "vitest";

import { COMMANDS, getCommand } from "../commands/commands";
import { findConflicts } from "../commands/conflicts";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { buildKeymap, effectiveKeys } from "../commands/keymap";
import { createCommandsProvider } from "../palette/providers/commands";
import {
  registerTagActions,
  registerTagSortToggle,
  toggleTagSort,
} from "../tags/tagActions";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";
import { DEFAULT_PREFERENCES } from "../vault/preferences";

import type { Platform } from "../commands/types";

const EXPECTED = {
  "tags.rename": "Tags: Rename tag…",
  "tags.focusPane": "Tags: Focus tags pane",
  "tags.toggleSort": "Tags: Toggle sort by name/count",
} as const;
const PLATFORMS: Platform[] = ["mac", "win", "linux"];

describe("Tags commands", () => {
  it.each(Object.entries(EXPECTED))("registers %s", (id, title) => {
    const c = getCommand(id)!;
    expect(c.title).toBe(title);
    expect(c.category).toBe("Tags");
    expect(c.keys.default).toEqual([]);
  });

  it.each(PLATFORMS)("has no conflicts on %s", (p) => {
    expect(findConflicts(COMMANDS, {}, p).size).toBe(0);
  });

  it("shows in the command palette", () => {
    const provider = createCommandsProvider({
      runner: {
        run: vi.fn(() => true),
        isAvailable: () => true,
        platform: "mac",
      },
      overrides: () => ({}),
    });
    const keys = provider.items().map((i) => i.key);
    for (const id of Object.keys(EXPECTED)) {
      expect(keys).toContain(`command:${id}`);
    }
  });

  it("is rebindable and round-trips through [hotkeys]", () => {
    const overrides = { "tags.rename": ["Mod+Alt+R"] };
    const map = buildKeymap(COMMANDS, overrides, "mac");
    expect(effectiveKeys(getCommand("tags.rename")!, overrides, "mac")).toEqual(
      ["Mod+Alt+R"],
    );
    expect(map).toBeDefined();
    const { values, problems } = configToPreferences({
      hotkeys: { "tags.rename": ["cmd+alt+r"] },
    });
    expect(problems).toEqual([]);
    expect(values.hotkeys?.["tags.rename"]).toBeDefined();
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      hotkeys: overrides,
    });
    expect(changes.map((c) => c.key)).toEqual(["hotkeys.tags.rename"]);
  });

  it("handlers resolve through the registry", () => {
    const rename = vi.fn();
    const stop = registerCommandHandlers({ "tags.rename": rename });
    getRegisteredHandler("tags.rename")?.();
    expect(rename).toHaveBeenCalled();
    stop();
    expect(getRegisteredHandler("tags.rename")).toBeUndefined();
  });

  it("toggleTagSort calls the mounted pane and is a no-op otherwise", () => {
    toggleTagSort();
    const toggle = vi.fn();
    const off = registerTagSortToggle(toggle);
    toggleTagSort();
    expect(toggle).toHaveBeenCalledTimes(1);
    off();
    toggleTagSort();
    expect(toggle).toHaveBeenCalledTimes(1);
    registerTagActions({ filter: () => {}, focusPane: () => {} })();
  });
});
