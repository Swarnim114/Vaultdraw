import { describe, expect, it } from "vitest";

import { COMMANDS, defaultKeys } from "./commands";
import { findConflicts } from "./conflicts";
import { excalidrawActionsFor } from "./excalidrawKeys";
import { normalizeChord } from "./keys";
import { reservedReason } from "./reserved";
import { TAB_COMMAND_IDS, TAB_COMMANDS } from "./tabCommands";

import type { Platform } from "./types";

const PLATFORMS: Platform[] = ["mac", "win", "linux"];

const chordsOf = (platform: Platform) =>
  TAB_COMMANDS.flatMap((command) =>
    defaultKeys(command, platform).map((chord) => ({ command, chord })),
  );

describe("TAB_COMMANDS", () => {
  it("has unique, namespaced ids matching TAB_COMMAND_IDS", () => {
    const ids = TAB_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.values(TAB_COMMAND_IDS).sort());
    for (const id of ids) {
      expect(id).toMatch(/^(tabs|file|window)\.[a-zA-Z0-9]+$/);
    }
    for (const command of TAB_COMMANDS) {
      expect(command.category).toBe("Tabs");
    }
  });

  it("does not reuse ids of registered commands", () => {
    const existing = new Set(COMMANDS.map((c) => c.id));
    for (const command of TAB_COMMANDS) {
      expect(existing.has(command.id)).toBe(false);
    }
  });

  it.each(PLATFORMS)("keeps Ctrl distinct from Mod on %s", (platform) => {
    expect(normalizeChord("Ctrl+Tab", platform)).toBe(
      platform === "mac" ? "Ctrl+Tab" : "Mod+Tab",
    );
  });

  it.each(PLATFORMS)("every default chord normalizes on %s", (platform) => {
    for (const { chord } of chordsOf(platform)) {
      const normalized = normalizeChord(chord, platform);
      expect(normalized).toBeTruthy();
      expect(normalizeChord(normalized, platform)).toBe(normalized);
    }
  });

  it.each(PLATFORMS)(
    "has no duplicate chords among tab commands on %s",
    (platform) => {
      const chords = chordsOf(platform).map(({ chord }) =>
        normalizeChord(chord, platform),
      );
      expect(new Set(chords).size).toBe(chords.length);
    },
  );

  it.each(PLATFORMS)(
    "does not collide with registered commands on %s",
    (platform) => {
      const result = findConflicts(
        [...COMMANDS, ...TAB_COMMANDS],
        {},
        platform,
      );
      const tabIds = new Set<string>(TAB_COMMANDS.map((c) => c.id));
      const bad = [...result.entries()]
        .filter(([id]) => tabIds.has(id))
        .flatMap(([id, perChord]) =>
          [...perChord.entries()].flatMap(([chord, found]) =>
            found
              .filter((f) => f.kind === "command")
              .map((f) => `${id} ${chord} ~ ${JSON.stringify(f)}`),
          ),
        );
      expect(bad).toEqual([]);
      // and no existing command is now in conflict either
      const existing = [...result.entries()].filter(
        ([id]) =>
          !tabIds.has(id) &&
          [...result.get(id)!.values()].some((f) =>
            f.some((x) => x.kind === "command"),
          ),
      );
      expect(existing).toEqual([]);
    },
  );

  it.each(PLATFORMS)(
    "does not collide with Excalidraw keys on %s",
    (platform) => {
      const bad = chordsOf(platform).flatMap(({ command, chord }) =>
        excalidrawActionsFor(chord, platform).map(
          (k) => `${command.id} ${chord} ~ ${k.label}`,
        ),
      );
      expect(bad).toEqual([]);
    },
  );

  it.each(PLATFORMS)(
    "is reserved only for Mod+W on mac (pending menu change) on %s",
    (platform) => {
      const reserved = chordsOf(platform)
        .filter(({ chord }) => reservedReason(chord, platform))
        .map(({ command, chord }) => `${command.id} ${chord}`);
      expect(reserved).toEqual(platform === "mac" ? ["tabs.close Mod+W"] : []);
    },
  );
});
