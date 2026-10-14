import { beforeEach, describe, expect, it } from "vitest";

import { updatePageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import {
  getDefaultPageSetup,
  getNewDrawingPageSetup,
  pagePrefsFromPageSetup,
  pageSetupFromPagePrefs,
  setDefaultPageSetup,
} from "../vault/pageDefaults";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";

describe("page preferences normalization", () => {
  it("defaults to a normal canvas with separate A4 pages", () => {
    expect(normalizePreferences({})).toMatchObject({
      pageMode: "normal",
      pageLayout: "separate",
      pageSize: "a4",
      pageOrientation: "portrait",
      pageWidth: 0,
      pageHeight: 0,
      pagePaperTheme: "normal",
    });
  });

  it("keeps valid values and replaces invalid ones field by field", () => {
    expect(
      normalizePreferences({
        pageMode: "page",
        pageLayout: "continuous",
        pageSize: "custom",
        pageOrientation: "landscape",
        pageWidth: 900,
        pageHeight: 1200,
        pagePaperTheme: "old_school",
      }),
    ).toMatchObject({
      pageMode: "page",
      pageLayout: "continuous",
      pageSize: "custom",
      pageOrientation: "landscape",
      pageWidth: 900,
      pageHeight: 1200,
      pagePaperTheme: "old_school",
    });
    expect(
      normalizePreferences({
        pageMode: "both",
        pageLayout: "grid",
        pageSize: "a9",
        pageOrientation: "tilted",
        pageWidth: 50,
        pageHeight: 99999,
        pagePaperTheme: "oldSchool",
      }),
    ).toMatchObject({
      pageMode: "normal",
      pageLayout: "separate",
      pageSize: "a4",
      pageOrientation: "portrait",
      pageWidth: 0,
      pageHeight: 0,
      pagePaperTheme: "normal",
    });
  });
});

describe("page setup <-> preferences", () => {
  it("the defaults are a disabled A4 portrait setup", () => {
    expect(pageSetupFromPagePrefs(DEFAULT_PREFERENCES)).toMatchObject({
      enabled: false,
      layout: "separate",
      size: "a4",
      width: 794,
      height: 1123,
      paperTheme: "normal",
    });
  });

  it("maps old_school and the mode", () => {
    const setup = pageSetupFromPagePrefs({
      ...DEFAULT_PREFERENCES,
      pageMode: "page",
      pageOrientation: "landscape",
      pagePaperTheme: "old_school",
    });
    expect(setup).toMatchObject({
      enabled: true,
      paperTheme: "oldSchool",
      width: 1123,
      height: 794,
    });
  });

  it("custom sizes use the stored pixels; unset sides fall back to A4's", () => {
    expect(
      pageSetupFromPagePrefs({
        ...DEFAULT_PREFERENCES,
        pageSize: "custom",
        pageWidth: 900,
        pageHeight: 0,
      }),
    ).toMatchObject({ size: "custom", width: 900, height: 1123 });
  });

  it("round trips", () => {
    for (const setup of [
      updatePageSetup(null, {
        layout: "continuous",
        size: "legal",
        orientation: "landscape",
        paperTheme: "match",
      }),
      updatePageSetup(null, {
        enabled: false,
        size: "custom",
        width: 700,
        height: 900,
      }),
    ]) {
      expect(
        pageSetupFromPagePrefs(pagePrefsFromPageSetup(setup)),
      ).toMatchObject({ ...setup, pageCount: 1 });
    }
  });
});

describe("app default page setup", () => {
  beforeEach(() => window.localStorage.clear());

  it("new drawings get nothing while the default mode is Normal", () => {
    expect(getNewDrawingPageSetup()).toBeNull();
    expect(getDefaultPageSetup().enabled).toBe(false);
  });

  it("Make app default stores the setup; new drawings are stamped with it", () => {
    setDefaultPageSetup(
      updatePageSetup(null, {
        layout: "continuous",
        size: "letter",
        paperTheme: "oldSchool",
      }),
    );
    expect(getPreferences()).toMatchObject({
      pageMode: "page",
      pageLayout: "continuous",
      pageSize: "letter",
      pagePaperTheme: "old_school",
    });
    expect(getNewDrawingPageSetup()).toMatchObject({
      enabled: true,
      layout: "continuous",
      size: "letter",
      paperTheme: "oldSchool",
      pageCount: 1,
    });
  });

  it("follows preference changes (settings / config.toml)", () => {
    updatePreferences({ pageMode: "page", pageSize: "a5" });
    expect(getNewDrawingPageSetup()).toMatchObject({ size: "a5" });
    updatePreferences({ pageMode: "normal" });
    expect(getNewDrawingPageSetup()).toBeNull();
  });
});
