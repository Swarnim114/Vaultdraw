import { useState } from "react";

import {
  getSettingsStatus,
  openConfigDir,
  reloadSettings,
} from "../../../vault/settingsSync";
import { IconDrawing, IconFolder, IconRefresh } from "../../Icons";
import { getSettingSchema } from "../schema";
import { useSettings, type SettingControls } from "../SettingsContext";
import { SettingRow } from "../SettingRow";

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const ConfigFileSetting = () => {
  const { settingsStatus, setSettingsStatus } = useSettings();
  const [action, setAction] = useState<{
    message: string;
    type: "info" | "error";
  } | null>(null);

  const handleOpen = async () => {
    setAction(null);
    try {
      await openConfigDir();
    } catch (err) {
      setAction({
        message: `Could not open the config folder: ${errorText(err)}`,
        type: "error",
      });
    }
  };

  const handleReload = async () => {
    setAction(null);
    try {
      const changed = await reloadSettings();
      const status = getSettingsStatus();
      setSettingsStatus(status);
      setAction(
        status.problems.length
          ? { message: status.problems[0].message, type: "error" }
          : {
              message: changed
                ? "Reloaded config.toml."
                : "config.toml is up to date.",
              type: "info",
            },
      );
    } catch (err) {
      setAction({
        message: `Could not reload: ${errorText(err)}`,
        type: "error",
      });
    }
  };

  return (
    <SettingRow
      id="config-file"
      className="vault-config-row"
      testId="settings-config-row"
      details={
        <>
          <code className="vault-config-path">
            {settingsStatus.configPath ?? "Unknown location"}
          </code>
          {action && (
            <div
              className={`vault-config-status vault-config-status--${action.type}`}
              role="status"
            >
              {action.message}
            </div>
          )}
        </>
      }
    >
      <div className="vault-config-actions">
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => void handleOpen()}
        >
          <IconFolder />
          <span>Open config folder</span>
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => void handleReload()}
        >
          <IconRefresh />
          <span>Reload</span>
        </button>
      </div>
    </SettingRow>
  );
};

const AboutSetting = () => (
  <div
    className="vault-setting-block vault-settings-about"
    data-setting-id="about"
  >
    <div className="vault-settings-about__hero">
      <IconDrawing width="44" height="44" />
      <h3 className="vault-settings-about__name">Vaultdraw</h3>
      <div className="vault-settings-about__version">
        Version 0.1.0 • Offline Private Local Vault
      </div>
    </div>
    <div className="vault-setting-info">
      <div className="vault-setting-label">
        100% Offline &amp; Private Local Vault
      </div>
      <div className="vault-setting-desc">
        {getSettingSchema("about").description}
      </div>
    </div>
  </div>
);

export const generalControls: SettingControls = {
  "config-file": {
    Component: ConfigFileSetting,
    available: (ctx) => ctx.settingsStatus.mode === "tauri",
  },
  about: { Component: AboutSetting },
};
