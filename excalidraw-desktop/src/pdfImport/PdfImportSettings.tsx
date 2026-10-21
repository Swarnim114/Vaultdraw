import { useEffect, useState } from "react";

import { SettingRow } from "../components/settings/SettingRow";
import {
  useSettings,
  type SettingControls,
} from "../components/settings/SettingsContext";
import {
  Segmented,
  Stepper,
  Switch,
} from "../components/settings/pages/controls";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  subscribePreferences,
  updatePreferences,
  type PreferencesSnapshot,
} from "../vault/preferences";

import { PDF_IMPORT_LIMITS, type PdfImageFormat } from "./types";

const usePrefs = (): PreferencesSnapshot => {
  const { win } = useSettings();
  const [prefs, setPrefs] = useState(() => getPreferences(win));
  useEffect(
    () => subscribePreferences(() => setPrefs(getPreferences(win))),
    [win],
  );
  return prefs;
};

type NumberFieldName =
  | "pdfMaxSide"
  | "pdfQuality"
  | "pdfWarnPages"
  | "pdfPixelBudgetMp";

/** Shared stepper row for one numeric preference. */
const NumberSetting = ({
  id,
  field,
  label,
  unit,
  limits,
  step,
}: {
  id: string;
  field: NumberFieldName;
  label: string;
  unit?: string;
  limits: { min: number; max: number };
  step: number;
}) => {
  const { win } = useSettings();
  const value = usePrefs()[field];
  return (
    <SettingRow
      id={id}
      onReset={
        value === DEFAULT_PREFERENCES[field]
          ? undefined
          : () =>
              updatePreferences({ [field]: DEFAULT_PREFERENCES[field] }, win)
      }
    >
      <Stepper
        label={label}
        unit={unit}
        {...limits}
        step={step}
        value={value}
        // Round away float drift from fractional steps (0.05).
        onChange={(next) =>
          updatePreferences({ [field]: Math.round(next * 1e4) / 1e4 }, win)
        }
      />
    </SettingRow>
  );
};

const FORMATS: readonly { label: string; val: PdfImageFormat }[] = [
  { label: "JPEG", val: "jpeg" },
  { label: "PNG", val: "png" },
];

const FormatSetting = () => {
  const { win } = useSettings();
  const { pdfFormat } = usePrefs();
  return (
    <SettingRow id="pdf-format">
      <Segmented
        options={FORMATS}
        value={pdfFormat}
        onChange={(format) => updatePreferences({ pdfFormat: format }, win)}
      />
    </SettingRow>
  );
};

const LockSetting = () => {
  const { win } = useSettings();
  const { pdfLockPages } = usePrefs();
  return (
    <SettingRow id="pdf-lock-pages" htmlFor="vault-pdf-lock-pages">
      <Switch
        id="vault-pdf-lock-pages"
        checked={pdfLockPages}
        onChange={(lock) => updatePreferences({ pdfLockPages: lock }, win)}
      />
    </SettingRow>
  );
};

/** The `[pdf_import]` rows of the Files page (ids match schema.ts). */
export const pdfImportControls: SettingControls = {
  "pdf-max-side": {
    Component: () => (
      <NumberSetting
        id="pdf-max-side"
        field="pdfMaxSide"
        label="PDF page resolution"
        unit="px"
        limits={PDF_IMPORT_LIMITS.maxSide}
        step={100}
      />
    ),
  },
  "pdf-format": { Component: FormatSetting },
  "pdf-quality": {
    Component: () => (
      <NumberSetting
        id="pdf-quality"
        field="pdfQuality"
        label="PDF JPEG quality"
        limits={PDF_IMPORT_LIMITS.quality}
        step={0.05}
      />
    ),
  },
  "pdf-lock-pages": { Component: LockSetting },
  "pdf-warn-pages": {
    Component: () => (
      <NumberSetting
        id="pdf-warn-pages"
        field="pdfWarnPages"
        label="PDF page count warning"
        unit="pages"
        limits={PDF_IMPORT_LIMITS.warnPages}
        step={10}
      />
    ),
  },
  "pdf-pixel-budget": {
    Component: () => (
      <NumberSetting
        id="pdf-pixel-budget"
        field="pdfPixelBudgetMp"
        label="PDF pixel budget"
        unit="MP"
        limits={PDF_IMPORT_LIMITS.pixelBudgetMp}
        step={10}
      />
    ),
  },
};
