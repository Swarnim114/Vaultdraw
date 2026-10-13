import { useState } from "react";

import { isVaultRelativeFolder } from "../../../vault/settingsSync";
import { IconFolder } from "../../Icons";
import { useSettings, type SettingControls } from "../SettingsContext";
import { SettingRow } from "../SettingRow";

import { Switch } from "./controls";
import { PerVaultRow } from "./perVault";

const AUTOSAVE_OPTIONS = [250, 500, 1000, 2000] as const;

const VaultFolderSetting = () => {
  const { vault, onRevealVault } = useSettings();
  return (
    <SettingRow
      id="vault-folder"
      details={
        <code className="vault-config-path">
          {vault?.path ?? "No vault currently open"}
        </code>
      }
    >
      {vault && onRevealVault && (
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => onRevealVault("")}
        >
          <IconFolder />
          <span>Reveal Folder</span>
        </button>
      )}
    </SettingRow>
  );
};

const AutosaveSetting = () => {
  const { autosaveDelay, setAutosaveDelay } = useSettings();
  return (
    <SettingRow
      id="autosave"
      description={`Time to wait after last drawing edit before writing atomically to disk (${autosaveDelay}ms).`}
    >
      <div className="vault-setting-inline">
        <input
          type="range"
          className="vault-range"
          min="200"
          max="2000"
          step="50"
          value={autosaveDelay}
          aria-label="Autosave delay"
          onChange={(e) => setAutosaveDelay(Number(e.target.value))}
        />
        <select
          className="vault-input vault-input--compact"
          aria-label="Autosave delay preset"
          value={autosaveDelay}
          onChange={(e) => setAutosaveDelay(Number(e.target.value))}
        >
          {AUTOSAVE_OPTIONS.map((ms) => (
            <option key={ms} value={ms}>
              {ms} ms
            </option>
          ))}
        </select>
      </div>
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
}: {
  value: string;
  onCommit: (folder: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return;
    }
    const next = normaliseFolder(draft);
    if (!isVaultRelativeFolder(next)) {
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
      <input
        type="text"
        className="vault-input"
        aria-label="Default folder for new drawings"
        aria-invalid={error !== null}
        placeholder="Next to the open drawing"
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
  <PerVaultRow
    id="new-drawing-folder"
    field="newDrawingFolder"
    details={
      <div className="vault-setting-hint">Empty = next to the open drawing</div>
    }
  >
    {(value, onChange) => <FolderInput value={value} onCommit={onChange} />}
  </PerVaultRow>
);

export const filesControls: SettingControls = {
  "vault-folder": { Component: VaultFolderSetting },
  autosave: { Component: AutosaveSetting },
  "confirm-delete": { Component: ConfirmDeleteSetting },
  "new-drawing-folder": { Component: NewDrawingFolderSetting },
};
