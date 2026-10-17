import { describe, expect, it } from "vitest";

import { DEFAULT_PDF_IMPORT_SETTINGS } from "../pdfImport/types";
import {
  DEFAULT_PREFERENCES,
  getPdfImportSettings,
  normalizePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

describe("[pdf_import] settings: config -> prefs -> config", () => {
  it("defaults follow DEFAULT_PDF_IMPORT_SETTINGS", () => {
    expect(getPdfImportSettings(DEFAULT_PREFERENCES)).toEqual(
      DEFAULT_PDF_IMPORT_SETTINGS,
    );
    const { values, problems } = configToPreferences({});
    expect(getPdfImportSettings({ ...DEFAULT_PREFERENCES, ...values })).toEqual(
      DEFAULT_PDF_IMPORT_SETTINGS,
    );
    expect(problems.filter((p) => p.key?.startsWith("pdf_import."))).toEqual(
      [],
    );
  });

  it("reads valid values and reports bad ones", () => {
    const ok = configToPreferences({
      pdf_import: {
        max_side: 2000,
        format: "png",
        quality: 0.7,
        lock_pages: false,
        warn_pages: 20,
        pixel_budget_mp: 120,
      },
    });
    expect(ok.problems).toEqual([]);
    expect(
      getPdfImportSettings({ ...DEFAULT_PREFERENCES, ...ok.values }),
    ).toEqual({
      maxSide: 2000,
      format: "png",
      quality: 0.7,
      lockPages: false,
      warnPages: 20,
      pixelBudgetMp: 120,
    });
    const bad = configToPreferences({
      pdf_import: {
        max_side: 50,
        format: "gif",
        quality: 2,
        lock_pages: "yes",
        warn_pages: 0,
        pixel_budget_mp: 1,
      },
    });
    expect(bad.problems.map((p) => p.key).sort()).toEqual([
      "pdf_import.format",
      "pdf_import.lock_pages",
      "pdf_import.max_side",
      "pdf_import.pixel_budget_mp",
      "pdf_import.quality",
      "pdf_import.warn_pages",
    ]);
  });

  it("writes changed values back under [pdf_import]", () => {
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      pdfMaxSide: 1800,
      pdfFormat: "png",
    });
    const byKey = Object.fromEntries(changes.map((c) => [c.key, c.value]));
    expect(byKey["pdf_import.max_side"]).toBe(1800);
    expect(byKey["pdf_import.format"]).toBe("png");
  });

  it("normalises stored preferences, falling back per field", () => {
    const prefs = normalizePreferences({
      pdfMaxSide: 1800,
      pdfFormat: "bmp",
      pdfLockPages: false,
    });
    expect(prefs.pdfMaxSide).toBe(1800);
    expect(prefs.pdfFormat).toBe(DEFAULT_PREFERENCES.pdfFormat);
    expect(prefs.pdfLockPages).toBe(false);
  });
});
