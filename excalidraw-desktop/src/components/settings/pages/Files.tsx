import { IconFolder } from "../../Icons";
import { useSettings, type SettingControls } from "../SettingsContext";
import { SettingRow } from "../SettingRow";

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

export const filesControls: SettingControls = {
  "vault-folder": { Component: VaultFolderSetting },
  autosave: { Component: AutosaveSetting },
};
