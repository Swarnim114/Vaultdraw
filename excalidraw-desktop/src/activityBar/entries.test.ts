import { describe, expect, it } from "vitest";

import { getCommand } from "../commands/commands";

import {
  ACTIVITY_ENTRIES,
  resolveEntryState,
  type EntryContext,
} from "./entries";

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({
  hasHandler: () => true,
  isAvailable: () => true,
  shortcut: () => "",
  ...over,
});

const entry = ACTIVITY_ENTRIES.find((e) => e.id === "library")!;

describe("ACTIVITY_ENTRIES", () => {
  it("has unique ids", () => {
    const ids = ACTIVITY_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs only registered commands", () => {
    for (const e of ACTIVITY_ENTRIES) {
      expect(getCommand(e.commandId), e.commandId).toBeDefined();
    }
  });

  it("lists the expected entries by group", () => {
    const of = (g: string) =>
      ACTIVITY_ENTRIES.filter((e) => e.group === g).map((e) => e.id);
    expect(of("top")).toEqual([
      "library",
      "history",
      "graph",
      "gallery",
      "search",
      "tags",
      "templates",
    ]);
    expect(of("bottom")).toEqual(["hotkeys", "settings"]);
  });

  it("gives panel entries an active store", () => {
    for (const id of ["library", "history", "graph", "gallery"]) {
      expect(ACTIVITY_ENTRIES.find((e) => e.id === id)?.active).toBeDefined();
    }
  });
});

describe("resolveEntryState", () => {
  it("hides an entry whose command has no handler", () => {
    expect(
      resolveEntryState(entry, ctx({ hasHandler: () => false })).hidden,
    ).toBe(true);
  });

  it("disables with a reason when the command is unavailable", () => {
    expect(resolveEntryState(entry, ctx({ isAvailable: () => false }))).toEqual(
      {
        hidden: false,
        disabled: true,
        title: "Library - Open a drawing first",
      },
    );
  });

  it("enables with the shortcut in the tooltip", () => {
    expect(resolveEntryState(entry, ctx({ shortcut: () => "Ctrl+L" }))).toEqual(
      {
        hidden: false,
        disabled: false,
        title: "Library (Ctrl+L)",
      },
    );
  });

  it("omits the parentheses when unbound", () => {
    expect(resolveEntryState(entry, ctx()).title).toBe("Library");
  });
});
