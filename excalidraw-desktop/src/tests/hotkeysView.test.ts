import { describe, expect, it } from "vitest";

import { findConflicts } from "../commands/conflicts";
import { formatChordParts } from "../commands/keys";
import {
  conflictSentence,
  filterCounts,
  filterInfos,
  groupByCategory,
  type HotkeyInfo,
} from "../components/settings/pages/hotkeysView";

import type { CommandDefinition } from "../commands/types";

const cmd = (
  id: string,
  title: string,
  category: string,
  keys: string[],
): CommandDefinition =>
  ({ id, title, category, keys: { default: keys } } as CommandDefinition);

const info = (
  command: CommandDefinition,
  extra: Partial<HotkeyInfo> = {},
): HotkeyInfo => ({
  command,
  keys: command.keys.default as string[],
  customised: false,
  conflicted: false,
  ...extra,
});

const png = cmd("export.png", "Export: PNG", "Export", ["Mod+Shift+E"]);
const svg = cmd("export.svg", "Export: SVG", "Export", ["Mod+Shift+E"]);
const dark = cmd("mode.dark", "Mode: Dark", "Appearance", []);
const infos = [
  info(dark),
  info(png, { conflicted: true }),
  info(svg, { conflicted: true, customised: true }),
];

describe("hotkeys filters", () => {
  it("counts every chip in one pass", () => {
    expect(filterCounts(infos)).toEqual({
      all: 3,
      assigned: 2,
      customised: 1,
      unassigned: 1,
      conflicts: 2,
    });
  });

  it("combines text, recorded chord and chip", () => {
    const ids = (r: HotkeyInfo[]) => r.map((i) => i.command.id);
    const base = { text: "", chord: null, filter: "all" as const };
    expect(ids(filterInfos(infos, { ...base, filter: "unassigned" }))).toEqual([
      "mode.dark",
    ]);
    expect(ids(filterInfos(infos, { ...base, filter: "customised" }))).toEqual([
      "export.svg",
    ]);
    expect(ids(filterInfos(infos, { ...base, text: " svg " }))).toEqual([
      "export.svg",
    ]);
    expect(ids(filterInfos(infos, { ...base, text: "appearance" }))).toEqual([
      "mode.dark",
    ]);
    expect(ids(filterInfos(infos, { ...base, chord: "Mod+Shift+E" }))).toEqual([
      "export.png",
      "export.svg",
    ]);
  });

  it("groups consecutive rows by category", () => {
    const groups = groupByCategory([infos[1], infos[2], infos[0]]);
    expect(groups.map((g) => [g.category, g.infos.length])).toEqual([
      ["Export", 2],
      ["Appearance", 1],
    ]);
  });
});

describe("conflict sentence", () => {
  const commands = [png, svg];
  const conflicts = findConflicts(commands, {}, "mac");
  const rank = new Map(commands.map((c, i) => [c.id, i] as const));

  it("names the other command and which one wins", () => {
    expect(
      conflictSentence(svg, conflicts.get("export.svg"), rank, "mac"),
    ).toBe(
      "Also bound to Export: PNG. Export: PNG wins (first match). Change one of them.",
    );
    expect(
      conflictSentence(png, conflicts.get("export.png"), rank, "mac"),
    ).toBe(
      "Also bound to Export: SVG. This one wins (first match). Change one of them.",
    );
  });

  it("is null without conflicts", () => {
    expect(conflictSentence(dark, undefined, rank, "mac")).toBeNull();
  });

  it("explains a reserved chord", () => {
    const quit = cmd("x.quit", "Quit", "File", ["Mod+Q"]);
    const found = findConflicts([quit], {}, "mac");
    expect(
      conflictSentence(quit, found.get("x.quit"), new Map(), "mac"),
    ).toMatch(/can't work: the app menu quits Vaultdraw/);
  });
});

describe("formatChordParts", () => {
  it("splits a chord into key caps", () => {
    expect(formatChordParts("Mod+Shift+L", "mac")).toEqual(["⇧", "⌘", "L"]);
    expect(formatChordParts("Mod+Shift+L", "win")).toEqual([
      "Ctrl",
      "Shift",
      "L",
    ]);
  });
});
