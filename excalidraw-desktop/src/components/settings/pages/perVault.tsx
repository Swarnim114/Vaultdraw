import { SettingRow } from "../SettingRow";
import { useSettings } from "../SettingsContext";

import { Switch } from "./controls";

import type { ReactNode } from "react";

import type { VaultPreferences } from "../../../vault/preferences";
import type {
  EffectiveVaultSettings,
  VaultField,
} from "../../../vault/vaultSettings";

/**
 * A row whose value can be stored per vault. Renders the "This vault"
 * switch and passes the current effective value plus an edit callback that
 * writes to whichever layer is active.
 */
export const PerVaultRow = <F extends VaultField>({
  id,
  field,
  children,
  details,
  description,
  onReset,
}: {
  id: string;
  field: F;
  children: (
    value: EffectiveVaultSettings[F],
    onChange: (value: VaultPreferences[F]) => void,
  ) => ReactNode;
  details?: ReactNode;
  description?: ReactNode;
  onReset?: () => void;
}) => {
  const { vault, vaultSettings, setPerVaultValue, setPerVaultStored } =
    useSettings();
  const stored = vaultSettings.isOverridden(field);
  const unavailable = !vault || vault.readOnly;
  const title = !vault
    ? "Open a vault to store this setting in it"
    : vault.readOnly
    ? "This vault is read-only"
    : "Store this value in the vault instead of the global config";
  const errors = vaultSettings.problems.filter((p) => p.kind === "io");
  return (
    <SettingRow
      id={id}
      thisVault={stored}
      description={description}
      onReset={onReset}
      details={
        <>
          {details}
          {errors.map((p) => (
            <div
              key={p.message}
              className="vault-config-status vault-config-status--error"
              role="status"
            >
              {p.message}
            </div>
          ))}
        </>
      }
    >
      <div className="vault-setting-inline">
        {children(vaultSettings.effective[field], (value) =>
          setPerVaultValue(field, value),
        )}
        <label className="vault-setting-pervault" title={title}>
          <Switch
            checked={stored}
            disabled={unavailable}
            label="This vault"
            title={title}
            onChange={(on) => setPerVaultStored(field, on)}
          />
          <span>This vault</span>
        </label>
      </div>
    </SettingRow>
  );
};
