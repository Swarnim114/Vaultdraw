/**
 * Which layer Settings edits: the global config ("global") or the open
 * vault's overrides ("vault"). Module memory only: remembered while the app
 * runs, so a new session starts in the safe default (global).
 */
import { isStyledTool } from "../../toolDefaults/toolStyles";

import { SETTINGS_SCHEMA, parseSettingsTarget } from "./schema";

import type { SettingsTarget } from "./schema";

export type SettingsScope = "global" | "vault";

let scope: SettingsScope = "global";
const listeners = new Set<() => void>();

export const getSettingsScope = (): SettingsScope => scope;

export const setSettingsScope = (next: SettingsScope): void => {
  if (next === scope) {
    return;
  }
  scope = next;
  listeners.forEach((listener) => listener());
};

export const subscribeSettingsScope = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether `target` shows at least one per-vault row (else it is global-only). */
export const targetHasVaultRows = (target: SettingsTarget): boolean => {
  const { page, section } = parseSettingsTarget(target);
  if (section && !isStyledTool(section)) {
    return false;
  }
  return SETTINGS_SCHEMA.some(
    (s) => s.perVault && s.page === page && (!section || s.section === section),
  );
};
