import { useSyncExternalStore } from "react";

import type { BackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import {
  getDefaultBackgroundPattern,
  paperPrefsFromPattern,
  patternFromPaperPrefs,
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

import { ScopedRow } from "./scopedRow";

/** Re-renders when any preference changes (the pattern is derived on read). */
const usePreferencesVersion = (win: Window | null) =>
  useSyncExternalStore(subscribePreferences, () =>
    JSON.stringify(getPreferences(win)),
  );

export const PaperSetting = () => {
  const { win, mode, scope, scopedValue, setScopedValue } = useSettings();
  usePreferencesVersion(win);
  const inVault = scope === "vault";
  // Global scope tunes the global pattern; vault scope previews what the
  // vault resolves to (its style over the global tuning).
  const pattern = inVault
    ? getDefaultBackgroundPattern(win)
    : patternFromPaperPrefs(getPreferences(win));
  const style: PaperStyle = scopedValue("paperStyle");

  // A new style starts from its preset spacing and major lines.
  const selectStyle = (next: PaperStyle) => {
    if (next === style) {
      return;
    }
    setScopedValue("paperStyle", next);
    if (!inVault) {
      updatePreferences({ paperSpacing: 0, paperMajorEvery: 0 }, win);
    }
  };

  // Only the style can live in the vault; the tuning is global.
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
    <ScopedRow
      id="paper"
      field="paperStyle"
      testId="settings-paper"
      below={
        pattern && (
          <div className="vault-setting-field vault-paper-tuning">
            {inVault ? (
              <p className="vault-setting-hint">
                Fine-tuning is global. Switch to Global to change it.
              </p>
            ) : (
              <PaperControls value={pattern} onChange={tune} hideStyle />
            )}
            <PaperPreview pattern={pattern} theme={resolveTheme(mode, win)} />
          </div>
        )
      }
    >
      {(value) => <PaperTilePicker value={value} onChange={selectStyle} />}
    </ScopedRow>
  );
};
