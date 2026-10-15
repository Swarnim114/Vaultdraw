import { useSyncExternalStore } from "react";

import type { BackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import {
  getDefaultBackgroundPattern,
  paperPrefsFromPattern,
} from "../../../vault/paperDefaults";
import {
  getPreferences,
  resolveTheme,
  subscribePreferences,
  updatePreferences,
  type PaperStyle,
} from "../../../vault/preferences";
import { PaperControls } from "../../paper/PaperControls";
import { PaperPreview } from "../../paper/PaperPreview";
import { PaperTilePicker } from "../../paper/PaperTilePicker";
import { useSettings } from "../SettingsContext";

import "../paperSetting.css";

import { PerVaultRow } from "./perVault";

/** Re-renders when any preference changes (the pattern is derived on read). */
const usePreferencesVersion = (win: Window | null) =>
  useSyncExternalStore(subscribePreferences, () =>
    JSON.stringify(getPreferences(win)),
  );

export const PaperSetting = () => {
  const { win, mode, vaultSettings, setPerVaultValue } = useSettings();
  usePreferencesVersion(win);
  const pattern = getDefaultBackgroundPattern(win);
  const style: PaperStyle = vaultSettings.effective.paperStyle;

  // A new style starts from its preset spacing and major lines.
  const selectStyle = (next: PaperStyle) => {
    if (next === style) {
      return;
    }
    setPerVaultValue("paperStyle", next);
    updatePreferences({ paperSpacing: 0, paperMajorEvery: 0 }, win);
  };

  // The style itself may live in the vault; only the tuning is global.
  const tune = (next: BackgroundPattern | null) => {
    updatePreferences(
      {
        ...paperPrefsFromPattern(next),
        paperStyle: getPreferences(win).paperStyle,
      },
      win,
    );
  };

  return (
    <PerVaultRow
      id="paper"
      field="paperStyle"
      layout="stacked"
      details={
        pattern && (
          <div className="vault-setting-field">
            <PaperControls value={pattern} onChange={tune} hideStyle />
            <PaperPreview pattern={pattern} theme={resolveTheme(mode, win)} />
          </div>
        )
      }
    >
      {(value) => <PaperTilePicker value={value} onChange={selectStyle} />}
    </PerVaultRow>
  );
};
