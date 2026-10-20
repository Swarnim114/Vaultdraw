import { useCallback, useMemo, useSyncExternalStore } from "react";

import { getPreferences, subscribePreferences } from "./preferences";
import {
  getVaultSettingsSnapshot,
  PER_VAULT_FIELDS,
  resolveSettings,
  setVaultOverride,
  subscribeVaultSettings,
  type VaultField,
} from "./vaultSettings";

import type { UseVaultSettings } from "./useVaultSettings";

/** The global values of the per-vault fields as one comparable string. */
const globalsKey = (win: Window | null | undefined): string => {
  const prefs = getPreferences(win);
  return JSON.stringify(PER_VAULT_FIELDS.map((field) => prefs[field]));
};

/**
 * Read-only view of the per-vault settings store for components other than
 * the app shell (which alone attaches the store via useVaultSettings).
 */
export function useVaultSettingsView(
  win: Window | null | undefined,
): UseVaultSettings {
  const { overrides, problems } = useSyncExternalStore(
    subscribeVaultSettings,
    getVaultSettingsSnapshot,
  );
  const globals = useSyncExternalStore(subscribePreferences, () =>
    globalsKey(win),
  );

  const global = useMemo(() => {
    const values = JSON.parse(globals) as unknown[];
    return Object.fromEntries(
      PER_VAULT_FIELDS.map((field, i) => [field, values[i]]),
    ) as Parameters<typeof resolveSettings>[1];
  }, [globals]);
  const effective = useMemo(
    () => resolveSettings(overrides, global),
    [overrides, global],
  );

  const isOverridden = useCallback(
    (field: VaultField) => overrides[field] !== undefined,
    [overrides],
  );

  return {
    overrides,
    problems,
    global,
    effective,
    isOverridden,
    setOverride: setVaultOverride,
  };
}
