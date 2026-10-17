import { describe, expect, it } from "vitest";

import { COMMANDS } from "../commands/commands";

import { FORMULA_COMMANDS } from "./formulaCommands";

describe("formula commands", () => {
  it("are registered", () => {
    for (const c of FORMULA_COMMANDS) {
      expect(COMMANDS.find((x) => x.id === c.id)).toBe(c);
      expect(c.category).toBe("Formula");
    }
    expect(FORMULA_COMMANDS.map((c) => c.id)).toEqual([
      "formula.insert",
      "formula.edit",
    ]);
  });
});
