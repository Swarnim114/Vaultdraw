/** Command ids of the tool defaults (pure; commands.ts and the handlers share them). */
import type { StyledTool } from "./toolStyles";

export const toolDefaultSaveId = (tool: StyledTool) =>
  `toolDefaults.save.${tool}`;
export const toolDefaultResetId = (tool: StyledTool) =>
  `toolDefaults.reset.${tool}`;
export const TOOL_DEFAULT_SAVE_ACTIVE_ID = "toolDefaults.saveActive";
