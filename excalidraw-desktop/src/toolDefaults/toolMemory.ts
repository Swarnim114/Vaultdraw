/**
 * The last style each tool was used with, for the life of the app process
 * (FigJam model). Module-level on purpose: it survives the editor remounting
 * on a drawing or vault switch, is never persisted (every launch starts from
 * the saved defaults) and is never React state (no renders).
 */
import type { StyledTool, ToolStyle } from "./toolStyles";

const memory = new Map<StyledTool, ToolStyle>();

export const getToolMemory = (tool: StyledTool): ToolStyle | undefined =>
  memory.get(tool);

export const rememberToolStyle = (tool: StyledTool, style: ToolStyle) => {
  memory.set(tool, style);
};

/** A deliberately changed default must take effect: forget the tool's memory. */
export const clearToolMemory = (tool: StyledTool) => {
  memory.delete(tool);
};

/** Remembered styles by tool, to layer over the saved defaults. */
export const toolMemorySnapshot = (): Partial<Record<StyledTool, ToolStyle>> =>
  Object.fromEntries(memory);

export const clearAllToolMemory = () => memory.clear();
