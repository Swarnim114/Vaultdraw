import { useState } from "react";

import { DEFAULT_TEMPLATES_FOLDER } from "../../../templates/types";
import {
  isVaultRelativeFolder,
  openConfigDir,
} from "../../../vault/settingsSync";
import { IconFolder } from "../../Icons";
import { useSettings, type SettingControls } from "../SettingsContext";
import { SettingRow } from "../SettingRow";

import { RevealPath, Stepper, Switch } from "./controls";
import { PerVaultRow } from "./perVault";

/** Where the vault keeps crash-recovery copies (see `checked_recovery_dir`). */
const RECOVERY_SUBPATH = ".excalidraw-vault/recovery";

const VaultFolderSetting = () => {
  const { vault, onRevealVault } = useSettings();
  return (
    <SettingRow id="vault-folder">
      <RevealPath
        path={vault?.path ?? "No vault currently open"}
        label="Reveal vault folder"
        onReveal={vault && onRevealVault ? () => onRevealVault("") : undefined}
      />
    </SettingRow>
  );
};

const AutosaveSetting = () => {
  const { autosaveDelay, setAutosaveDelay } = useSettings();
  return (
    <SettingRow id="autosave">
      <Stepper
        label="Autosave delay"
        unit="ms"
        min={200}
        max={2000}
        step={50}
        value={autosaveDelay}
        onChange={setAutosaveDelay}
      />
    </SettingRow>
  );
};

const ConfirmDeleteSetting = () => {
  const { confirmDelete, setConfirmDelete } = useSettings();
  return (
    <SettingRow id="confirm-delete" htmlFor="vault-confirm-delete">
      <Switch
        id="vault-confirm-delete"
        checked={confirmDelete}
        onChange={setConfirmDelete}
      />
    </SettingRow>
  );
};

/** Trim and drop leading/trailing slashes. */
const normaliseFolder = (text: string) => text.trim().replace(/^\/+|\/+$/g, "");

const FolderInput = ({
  value,
  onCommit,
  label = "Default folder for new drawings",
  placeholder = "Next to the open drawing",
  allowEmpty = true,
}: {
  value: string;
  onCommit: (folder: string) => void;
  label?: string;
  placeholder?: string;
  allowEmpty?: boolean;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return;
    }
    const next = normaliseFolder(draft);
    if (!isVaultRelativeFolder(next) || (!allowEmpty && next === "")) {
      setError("Use a folder path inside the vault, like Inbox/Sketches.");
      return;
    }
    setError(null);
    setDraft(null);
    if (next !== value) {
      onCommit(next);
    }
  };
  return (
    <div className="vault-setting-field">
      <div className="vault-folder-field">
        <input
          type="text"
          className="vault-input"
          aria-label={label}
          aria-invalid={error !== null}
          placeholder={placeholder}
          spellCheck={false}
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
            } else if (e.key === "Escape" && draft !== null) {
              e.stopPropagation();
              setDraft(null);
              setError(null);
            }
          }}
        />
        <IconFolder className="vault-folder-field__icon" aria-hidden="true" />
      </div>
      {error && (
        <div
          className="vault-config-status vault-config-status--error"
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  );
};

const NewDrawingFolderSetting = () => (
  <PerVaultRow id="new-drawing-folder" field="newDrawingFolder">
    {(value, onChange) => <FolderInput value={value} onCommit={onChange} />}
  </PerVaultRow>
);

const TemplatesFolderSetting = () => (
  <PerVaultRow id="templates-folder" field="templatesFolder">
    {(value, onChange) => (
      <FolderInput
        value={value}
        onCommit={onChange}
        label="Templates folder"
        placeholder={DEFAULT_TEMPLATES_FOLDER}
        allowEmpty={false}
      />
    )}
  </PerVaultRow>
);

const RecoveryStoreSetting = () => {
  const { vault, onRevealRecovery } = useSettings();
  return (
    <SettingRow id="recovery-store">
      <RevealPath
        path={`${vault?.path ?? ""}/${RECOVERY_SUBPATH}`}
        label="Reveal recovery folder"
        onReveal={onRevealRecovery}
      />
    </SettingRow>
  );
};

const SettingsFileSetting = () => {
  const { settingsStatus } = useSettings();
  return (
    <SettingRow id="settings-file">
      <RevealPath
        path={settingsStatus.configPath ?? "config.toml"}
        label="Reveal settings file"
        onReveal={() => void openConfigDir().catch(() => {})}
      />
    </SettingRow>
  );
};

export const filesControls: SettingControls = {
  "vault-folder": { Component: VaultFolderSetting },
  autosave: { Component: AutosaveSetting },
  "confirm-delete": { Component: ConfirmDeleteSetting },
  "new-drawing-folder": { Component: NewDrawingFolderSetting },
  "templates-folder": { Component: TemplatesFolderSetting },
  "recovery-store": {
    Component: RecoveryStoreSetting,
    available: (ctx) => ctx.vault !== null && !!ctx.onRevealRecovery,
  },
  "settings-file": {
    Component: SettingsFileSetting,
    available: (ctx) => ctx.settingsStatus.mode === "tauri",
  },
};
