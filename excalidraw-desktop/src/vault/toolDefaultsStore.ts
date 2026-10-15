/**
 * The effective tool defaults (per-vault override ?? global preference) as a
 * tiny pure-ish store for the editor hook and the palette commands. Reads
 * the two existing stores; owns no state besides subscriptions.
 */
import {
  isEmptyStyle,
  orderedStyle,
  TOOL_DEFAULT_TOOLS,
  toolField,
  type StyledTool,
  type ToolDefaults,
  type ToolStyle,
} from "../toolDefaults/toolStyles";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "./preferences";
import {
  getVaultSettingsSnapshot,
  setVaultOverride,
  subscribeVaultSettings,
} from "./vaultSettings";

export type ToolDefaultLayer = "vault" | "global";

/** Which layer currently provides the tool's style. */
export const toolDefaultLayer = (tool: StyledTool): ToolDefaultLayer =>
  getVaultSettingsSnapshot().overrides[toolField(tool)] !== undefined
    ? "vault"
    : "global";

/** Per tool: the vault override when set, else the global style; empty omitted. */
export function getEffectiveToolDefaults(): ToolDefaults {
  const prefs = getPreferences();
  const { overrides } = getVaultSettingsSnapshot();
  const out: ToolDefaults = {};
  for (const tool of TOOL_DEFAULT_TOOLS) {
    const field = toolField(tool);
    const style = overrides[field] ?? prefs[field];
    if (!isEmptyStyle(style)) {
      out[tool] = { ...style };
    }
  }
  return out;
}

/**
 * Calls `cb` when the effective defaults changed (preferences or vault
 * settings edits that leave them untouched, such as zoom, do not fire).
 */
export function subscribeToolDefaults(cb: () => void): () => void {
  let last = JSON.stringify(getEffectiveToolDefaults());
  const check = () => {
    const next = JSON.stringify(getEffectiveToolDefaults());
    if (next !== last) {
      last = next;
      cb();
    }
  };
  const offPrefs = subscribePreferences(check);
  const offVault = subscribeVaultSettings(check);
  return () => {
    offPrefs();
    offVault();
  };
}

async function writeToolDefault(
  tool: StyledTool,
  style: ToolStyle | null,
): Promise<ToolDefaultLayer> {
  const field = toolField(tool);
  const ordered = style ? orderedStyle(tool, style) : null;
  if (toolDefaultLayer(tool) === "vault") {
    await setVaultOverride(field, ordered);
    return "vault";
  }
  updatePreferences({ [field]: ordered ?? {} }, undefined);
  return "global";
}

/** Save `style` for the tool at the layer in effect; returns that layer. */
export const saveToolDefault = (
  tool: StyledTool,
  style: ToolStyle,
): Promise<ToolDefaultLayer> => writeToolDefault(tool, style);

/** No defaults at the active layer: {} in the vault (stays overridden) or cleared globally. */
export async function resetToolDefault(
  tool: StyledTool,
): Promise<ToolDefaultLayer> {
  if (toolDefaultLayer(tool) === "vault") {
    await setVaultOverride(toolField(tool), {});
    return "vault";
  }
  updatePreferences({ [toolField(tool)]: {} }, undefined);
  return "global";
}
