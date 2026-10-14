import { describe, expect, it } from "vitest";

import { COMMANDS, defaultKeys, getCommand, isCommandId } from "./commands";
import {
  buildKeymap,
  effectiveKeys,
  isCustomised,
  overrideFor,
} from "./keymap";

import type { CommandDefinition } from "./types";

const cmd = (id: string) => getCommand(id) as CommandDefinition;

describe("commands registry", () => {
  it("has unique ids in namespace.camelCase form", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    }
    expect(isCommandId("file.save")).toBe(true);
    expect(isCommandId("nope.nope")).toBe(false);
    expect(getCommand("nope")).toBeUndefined();
  });

  it("only file.save passes the event through", () => {
    expect(COMMANDS.filter((c) => c.passThrough).map((c) => c.id)).toEqual([
      "file.save",
    ]);
  });

  it("uses platform keys over the default", () => {
    const c: CommandDefinition = {
      ...cmd("file.save"),
      keys: { default: ["Mod+S"], mac: ["Mod+Alt+S"] },
    };
    expect(defaultKeys(c, "mac")).toEqual(["Mod+Alt+S"]);
    expect(defaultKeys(c, "win")).toEqual(["Mod+S"]);
  });
});

describe("keymap", () => {
  it("uses defaults without overrides and the override list with one", () => {
    expect(effectiveKeys(cmd("vault.newDrawing"), {}, "mac")).toEqual([
      "Mod+N",
    ]);
    expect(
      effectiveKeys(
        cmd("vault.newDrawing"),
        { "vault.newDrawing": ["Cmd+Alt+N"] },
        "mac",
      ),
    ).toEqual(["Mod+Alt+N"]);
    expect(
      effectiveKeys(cmd("vault.newDrawing"), { "vault.newDrawing": [] }, "mac"),
    ).toEqual([]);
    expect(
      effectiveKeys(cmd("vault.newDrawing"), { toString: ["x"] }, "mac"),
    ).toEqual(["Mod+N"]);
  });

  it("overrideFor returns null when equal to the defaults", () => {
    const c = cmd("view.zoomIn");
    expect(
      overrideFor(c, ["Cmd+Shift+Equal", "Mod+Shift+NumpadAdd"], "mac"),
    ).toBeNull();
    expect(
      overrideFor(c, ["Mod+Shift+NumpadAdd", "Mod+Shift+Equal"], "win"),
    ).toBeNull();
    expect(overrideFor(c, ["Mod+Shift+Equal"], "mac")).toEqual([
      "Mod+Shift+Equal",
    ]);
    expect(overrideFor(c, [], "mac")).toEqual([]);
    expect(overrideFor(cmd("vault.switch"), [], "mac")).toBeNull();
    expect(overrideFor(cmd("vault.switch"), ["Mod+Alt+O"], "mac")).toEqual([
      "Mod+Alt+O",
    ]);
  });

  it("isCustomised compares with the defaults", () => {
    const c = cmd("file.save");
    expect(isCustomised(c, {}, "mac")).toBe(false);
    expect(isCustomised(c, { "file.save": ["Mod+S"] }, "mac")).toBe(false);
    expect(isCustomised(c, { "file.save": ["Meta+S"] }, "mac")).toBe(false);
    expect(isCustomised(c, { "file.save": ["Mod+Shift+S"] }, "mac")).toBe(true);
    expect(isCustomised(c, { "file.save": [] }, "mac")).toBe(true);
  });

  it("buildKeymap maps normalised chords in registry order", () => {
    const map = buildKeymap(COMMANDS, {}, "mac");
    expect(map.get("Mod+S")?.map((c) => c.id)).toEqual(["file.save"]);
    expect(map.get("Mod+Shift+Equal")?.map((c) => c.id)).toEqual([
      "view.zoomIn",
    ]);
    expect(map.get("Meta+S")).toBeUndefined();
    const shared = buildKeymap(
      COMMANDS,
      { "vault.newDrawing": ["Meta+S"], "file.duplicate": ["Mod+S"] },
      "mac",
    );
    expect(shared.get("Mod+S")?.map((c) => c.id)).toEqual([
      "file.save",
      "vault.newDrawing",
      "file.duplicate",
    ]);
    expect(shared.has("Mod+N")).toBe(false);
  });
});
