import { useSyncExternalStore } from "react";

import { BACKGROUND_PATTERN_TYPES } from "@excalidraw/excalidraw/data/backgroundPattern";

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
import { useSettings } from "../SettingsContext";

import { Segmented } from "./controls";
import { PerVaultRow } from "./perVault";

const STYLES: readonly { label: string; val: PaperStyle }[] = [
  { label: "Plain", val: "plain" },
  ...BACKGROUND_PATTERN_TYPES.map((type) => ({
    label: type[0].toUpperCase() + type.slice(1),
    val: type,
  })),
];

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
      details={
        pattern && (
          <div className="vault-setting-field">
            <PaperControls value={pattern} onChange={tune} hideStyle />
            <PaperPreview pattern={pattern} theme={resolveTheme(mode, win)} />
          </div>
        )
      }
    >
      {(value) => (
        <Segmented options={STYLES} value={value} onChange={selectStyle} />
      )}
    </PerVaultRow>
  );
};
