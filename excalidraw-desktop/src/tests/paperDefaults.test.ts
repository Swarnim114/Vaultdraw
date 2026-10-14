import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

import {
  getDefaultBackgroundPattern,
  paperPrefsFromPattern,
  patternFromPaperPrefs,
  setDefaultBackgroundPattern,
} from "../vault/paperDefaults";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  attachVaultSettings,
  detachVaultSettings,
  setVaultOverride,
} from "../vault/vaultSettings";

const prefs = (partial: Partial<typeof DEFAULT_PREFERENCES>) => ({
  ...DEFAULT_PREFERENCES,
  ...partial,
});

describe("paper preferences normalization", () => {
  it("defaults to plain with presets", () => {
    expect(normalizePreferences({})).toMatchObject({
      paperStyle: "plain",
      paperSpacing: 0,
      paperColor: "",
      paperOpacity: 1,
      paperMajorEvery: 0,
      paperMarginLine: true,
    });
  });

  it("keeps valid values and replaces invalid ones field by field", () => {
    expect(
      normalizePreferences({
        paperStyle: "dots",
        paperSpacing: 30,
        paperColor: "#AABBCC",
        paperOpacity: 0.4,
        paperMajorEvery: 5,
        paperMarginLine: false,
      }),
    ).toMatchObject({
      paperStyle: "dots",
      paperSpacing: 30,
      paperColor: "#AABBCC",
      paperOpacity: 0.4,
      paperMajorEvery: 5,
      paperMarginLine: false,
    });
    expect(
      normalizePreferences({
        paperStyle: "wavy",
        paperSpacing: 2,
        paperColor: "red",
        paperOpacity: 5,
        paperMajorEvery: 99,
        paperMarginLine: "yes",
      }),
    ).toMatchObject({
      paperStyle: "plain",
      paperSpacing: 0,
      paperColor: "",
      paperOpacity: 1,
      paperMajorEvery: 0,
      paperMarginLine: true,
    });
  });
});

describe("patternFromPaperPrefs / paperPrefsFromPattern", () => {
  it("plain gives null", () => {
    expect(patternFromPaperPrefs(DEFAULT_PREFERENCES)).toBeNull();
    expect(paperPrefsFromPattern(null)).toEqual({
      paperStyle: "plain",
      paperSpacing: 0,
      paperColor: "",
      paperOpacity: 1,
      paperMajorEvery: 0,
      paperMarginLine: true,
    });
  });

  it("0 spacing and major-every use the preset, empty colour is automatic", () => {
    expect(patternFromPaperPrefs(prefs({ paperStyle: "graph" }))).toEqual(
      createBackgroundPattern("graph", { marginLine: true }),
    );
    expect(
      patternFromPaperPrefs(
        prefs({ paperStyle: "grid", paperSpacing: 40, paperColor: "#112233" }),
      ),
    ).toMatchObject({
      type: "grid",
      spacing: 40,
      majorEvery: 5,
      color: "#112233",
    });
  });

  it("round trips with explicit numbers", () => {
    const pattern = createBackgroundPattern("lines", {
      spacing: 28,
      color: "#445566",
      opacity: 0.6,
      marginLine: false,
    });
    const stored = paperPrefsFromPattern(pattern);
    expect(stored).toMatchObject({ paperStyle: "lines", paperSpacing: 28 });
    expect(patternFromPaperPrefs(stored)).toEqual(pattern);
  });
});

describe("effective default pattern", () => {
  beforeEach(() => {
    updatePreferences({ ...DEFAULT_PREFERENCES });
  });
  afterEach(() => {
    detachVaultSettings();
  });

  it("setDefaultBackgroundPattern writes the global prefs", () => {
    setDefaultBackgroundPattern(
      createBackgroundPattern("dots", { spacing: 30 }),
    );
    expect(getPreferences()).toMatchObject({
      paperStyle: "dots",
      paperSpacing: 30,
    });
    expect(getDefaultBackgroundPattern()).toMatchObject({
      type: "dots",
      spacing: 30,
    });
    setDefaultBackgroundPattern(null);
    expect(getDefaultBackgroundPattern()).toBeNull();
  });

  it("a per-vault style overrides the global one and starts from its preset", async () => {
    setDefaultBackgroundPattern(
      createBackgroundPattern("dots", { spacing: 30, opacity: 0.5 }),
    );
    await attachVaultSettings(window, "h1", { tauri: false });
    expect(await setVaultOverride("paperStyle", "graph")).toBe(true);
    expect(getDefaultBackgroundPattern()).toEqual(
      createBackgroundPattern("graph", { opacity: 0.5 }),
    );
    detachVaultSettings();
    expect(getDefaultBackgroundPattern()).toMatchObject({ type: "dots" });
  });
});
