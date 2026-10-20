import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { getPreferences, subscribePreferences } from "./preferences";
import {
  attachVaultSettings,
  detachVaultSettings,
  getVaultSettingsSnapshot,
  PER_VAULT_FIELDS,
  resolveSettings,
  setVaultOverride,
  subscribeVaultSettings,
  type EffectiveVaultSettings,
  type VaultField,
  type VaultOverrides,
} from "./vaultSettings";

import type { VaultPreferences } from "./preferences";
import type { SettingsProblem } from "./settingsSync";

const NO_OVERRIDES: VaultOverrides = {};
const NO_PROBLEMS: SettingsProblem[] = [];

/** The global values of the per-vault fields as one comparable string. */
const globalsKey = (win: Window | null | undefined): string => {
  const prefs = getPreferences(win);
  return JSON.stringify(PER_VAULT_FIELDS.map((field) => prefs[field]));
};

export interface UseVaultSettings {
  overrides: VaultOverrides;
  problems: SettingsProblem[];
  /** The global (config.toml) values, whatever the vault overrides. */
  global: EffectiveVaultSettings;
  effective: EffectiveVaultSettings;
  isOverridden: (field: VaultField) => boolean;
  setOverride: <F extends VaultField>(
    field: F,
    value: VaultPreferences[F] | null,
  ) => Promise<boolean>;
}

/**
 * Per-vault settings for the open vault. Attaches the (singleton) store to
 * the vault handle; use it from one component only (the app shell).
 */
export function useVaultSettings(
  win: Window | null | undefined,
  vault: { handle: string } | null,
): UseVaultSettings {
  const handle = vault?.handle ?? null;
  useEffect(() => {
    void attachVaultSettings(win, handle);
    return () => detachVaultSettings();
  }, [win, handle]);

  const snapshot = useSyncExternalStore(
    subscribeVaultSettings,
    getVaultSettingsSnapshot,
  );
  const globals = useSyncExternalStore(subscribePreferences, () =>
    globalsKey(win),
  );

  // Before the effect attaches, the snapshot may belong to another vault.
  const current = snapshot.handle === handle;
  const overrides = current ? snapshot.overrides : NO_OVERRIDES;
  const problems = current ? snapshot.problems : NO_PROBLEMS;

  const global = useMemo(() => {
    const values = JSON.parse(globals) as unknown[];
    return Object.fromEntries(
      PER_VAULT_FIELDS.map((field, i) => [field, values[i]]),
    ) as EffectiveVaultSettings;
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
