import { useEffect, useState } from "react";

import { SettingRow } from "../components/settings/SettingRow";
import {
  useSettings,
  type SettingControls,
} from "../components/settings/SettingsContext";
import { Segmented, Switch } from "../components/settings/pages/controls";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  subscribePreferences,
  updatePreferences,
  type VaultPreferences,
} from "../vault/preferences";

import { PDF_IMPORT_LIMITS, type PdfImageFormat } from "./types";

const usePrefs = (): VaultPreferences => {
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

/** Number input that commits on blur/Enter, clamped; unparsable reverts. */
const NumberSetting = ({
  id,
  field,
  label,
  limits,
  step,
}: {
  id: string;
  field: NumberFieldName;
  label: string;
  limits: { min: number; max: number };
  step: number;
}) => {
  const { win } = useSettings();
  const value = usePrefs()[field];
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(limits.max, Math.max(limits.min, parsed));
    setDraft(String(next));
    if (next !== value) {
      updatePreferences({ [field]: next }, win);
    }
  };
  return (
    <SettingRow
      id={id}
      htmlFor={`vault-${id}`}
      onReset={
        value === DEFAULT_PREFERENCES[field]
          ? undefined
          : () =>
              updatePreferences({ [field]: DEFAULT_PREFERENCES[field] }, win)
      }
    >
      <input
        id={`vault-${id}`}
        type="number"
        className="vault-input vault-input--number"
        aria-label={label}
        min={limits.min}
        max={limits.max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
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
        limits={PDF_IMPORT_LIMITS.pixelBudgetMp}
        step={10}
      />
    ),
  },
};
