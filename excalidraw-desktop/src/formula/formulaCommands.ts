/** Formula command metadata. Handlers are bound by useFormulaCommands. */
import type { CommandDefinition } from "../commands/types";

export const FORMULA_COMMAND_IDS = {
  insert: "formula.insert",
  edit: "formula.edit",
} as const;

const WHEN: CommandDefinition["when"] = [
  "drawingOpen",
  "writable",
  "!modalOpen",
];

export const FORMULA_COMMANDS: CommandDefinition[] = [
  {
    id: FORMULA_COMMAND_IDS.insert,
    title: "Formula: Insert formula",
    category: "Formula",
    keys: { default: ["Mod+Shift+M"] },
    when: [...WHEN],
  },
  {
    id: FORMULA_COMMAND_IDS.edit,
    title: "Formula: Edit formula",
    category: "Formula",
    keys: { default: [] },
    when: [...WHEN],
  },
];
