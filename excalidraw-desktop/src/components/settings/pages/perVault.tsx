import { SettingRow } from "../SettingRow";
import { useSettings } from "../SettingsContext";

import { Switch } from "./controls";

import type { ReactNode } from "react";

import type { VaultPreferences } from "../../../vault/preferences";
import type {
  EffectiveVaultSettings,
  VaultField,
} from "../../../vault/vaultSettings";

/** The "This vault" switch of a per-vault field (store it in the vault). */
export const PerVaultSwitch = ({
  field,
  label = "This vault",
}: {
  field: VaultField;
  /** Accessible name of the switch. */
  label?: string;
}) => {
  const { vault, vaultSettings, setPerVaultStored } = useSettings();
  const stored = vaultSettings.isOverridden(field);
  const unavailable = !vault || vault.readOnly;
  const title = !vault
    ? "Open a vault to store this setting in it"
    : vault.readOnly
    ? "This vault is read-only"
    : "Store this value in the vault instead of the global config";
  return (
    <label className="vault-setting-pervault" title={title}>
      <Switch
        checked={stored}
        disabled={unavailable}
        label={label}
        title={title}
        onChange={(on) => setPerVaultStored(field, on)}
      />
      <span>This vault</span>
    </label>
  );
};

/** Errors writing the vault's settings file (shown under per-vault rows). */
export const PerVaultErrors = () => {
  const { vaultSettings } = useSettings();
  return (
    <>
      {vaultSettings.problems
        .filter((p) => p.kind === "io")
        .map((p) => (
          <div
            key={p.message}
            className="vault-config-status vault-config-status--error"
            role="status"
          >
            {p.message}
          </div>
        ))}
    </>
  );
};

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
  below,
  description,
  onReset,
  layout,
  testId,
}: {
  id: string;
  field: F;
  children: (
    value: EffectiveVaultSettings[F],
    onChange: (value: VaultPreferences[F]) => void,
  ) => ReactNode;
  details?: ReactNode;
  /** Full-width block under the row. */
  below?: ReactNode;
  description?: ReactNode;
  onReset?: () => void;
  layout?: "row" | "block" | "stacked";
  testId?: string;
}) => {
  const { vaultSettings, setPerVaultValue } = useSettings();
  const stacked = layout === "stacked";
  const control = children(vaultSettings.effective[field], (value) =>
    setPerVaultValue(field, value),
  );
  const perVaultSwitch = <PerVaultSwitch field={field} />;
  return (
    <SettingRow
      id={id}
      description={description}
      onReset={onReset}
      layout={layout}
      below={below}
      aside={stacked ? perVaultSwitch : undefined}
      testId={testId}
      details={
        <>
          {details}
          <PerVaultErrors />
        </>
      }
    >
      {stacked ? (
        control
      ) : (
        <div className="vault-setting-inline">
          {control}
          {perVaultSwitch}
        </div>
      )}
    </SettingRow>
  );
};
