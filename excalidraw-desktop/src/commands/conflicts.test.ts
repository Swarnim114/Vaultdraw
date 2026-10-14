import { describe, expect, it } from "vitest";

import { COMMANDS } from "./commands";
import { conflictCount, findConflicts, whenCanOverlap } from "./conflicts";

import type { CommandDefinition } from "./types";

describe("whenCanOverlap", () => {
  it("only X vs !X is disjoint", () => {
    expect(whenCanOverlap(undefined, ["vaultOpen"])).toBe(true);
    expect(whenCanOverlap(["textEditing"], ["!textEditing"])).toBe(false);
    expect(whenCanOverlap(["vaultOpen", "!modalOpen"], ["modalOpen"])).toBe(
      false,
    );
    expect(whenCanOverlap(["vaultOpen"], ["drawingOpen"])).toBe(true);
  });
});

describe("findConflicts", () => {
  it("has none with the defaults", () => {
    const result = findConflicts(COMMANDS, {}, "mac");
    expect(result.size).toBe(0);
    expect(conflictCount(result)).toBe(0);
  });

  it("reports command vs command on both sides", () => {
    const result = findConflicts(
      COMMANDS,
      { "vault.switch": ["Cmd+N"] },
      "mac",
    );
    expect(result.get("vault.switch")?.get("Mod+N")).toEqual([
      { kind: "command", id: "vault.newDrawing", title: "New drawing" },
    ]);
    expect(result.get("vault.newDrawing")?.get("Mod+N")).toEqual([
      { kind: "command", id: "vault.switch", title: "Open another vault" },
    ]);
    expect(conflictCount(result)).toBe(2);
  });

  it("ignores commands whose contexts never overlap", () => {
    const a: CommandDefinition = {
      id: "a.one",
      title: "A",
      category: "File",
      keys: { default: ["Mod+J"] },
      when: ["textEditing"],
    };
    const b: CommandDefinition = {
      id: "a.two",
      title: "B",
      category: "File",
      keys: { default: ["Mod+J"] },
      when: ["!textEditing"],
    };
    expect(findConflicts([a, b], {}, "mac").size).toBe(0);
  });

  it("flags Excalidraw keys with the action label, not for defaults", () => {
    const result = findConflicts(
      COMMANDS,
      { "vault.switch": ["Mod+D"] },
      "mac",
    );
    expect(result.get("vault.switch")?.get("Mod+D")).toEqual([
      {
        kind: "excalidraw",
        action: "duplicateSelection",
        label: "Duplicate selection",
      },
    ]);
    // Mod+P and Mod+Shift+= are defaults that overlap Excalidraw on purpose
    expect(result.get("palette.files")).toBeUndefined();
    expect(result.get("palette.commands")).toBeUndefined();
  });

  it("flags reserved keys", () => {
    const result = findConflicts(
      COMMANDS,
      { "vault.switch": ["Mod+Q"] },
      "mac",
    );
    expect(result.get("vault.switch")?.get("Mod+Q")?.[0].kind).toBe("reserved");
  });

  it("normalises Meta/Ctrl per platform", () => {
    expect(
      findConflicts(COMMANDS, { "vault.switch": ["Ctrl+N"] }, "win")
        .get("vault.switch")
        ?.has("Mod+N"),
    ).toBe(true);
    expect(
      findConflicts(COMMANDS, { "vault.switch": ["Ctrl+N"] }, "mac").size,
    ).toBe(0);
  });
});
