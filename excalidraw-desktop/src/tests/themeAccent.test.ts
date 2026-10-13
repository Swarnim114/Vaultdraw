import { afterEach, describe, expect, it } from "vitest";

import {
  applyAccent,
  contrastRatio,
  deriveTokens,
  EXCALIDRAW_OVERRIDE_STYLE_ID,
  getBuiltinTheme,
  resolveAccent,
} from "../theme";
import { builtinRegistry } from "../theme/registry";
import {
  applyAppearance,
  computeAppearance,
  resetAppliedAppearance,
} from "../vault/appearance";

import type { ThemeMode } from "../theme";

const MODES: ThemeMode[] = ["light", "dark"];
const dracula = getBuiltinTheme("Dracula") ?? getBuiltinTheme("dracula")!;
const def = getBuiltinTheme("default")!;
const root = () => document.documentElement;

const snap = (colorTheme: string, theme: ThemeMode, accentColor: string) =>
  computeAppearance(
    { theme, colorTheme, syncCanvas: false, accentColor },
    builtinRegistry(),
    window,
  );

afterEach(() => {
  resetAppliedAppearance();
  root().removeAttribute("style");
});

describe("applyAccent", () => {
  it.each(MODES)("sets primary in %s mode", (mode) => {
    const v = applyAccent(dracula[mode], "#3366cc", mode);
    expect(v.mPrimary).toBe("#3366cc");
    expect(contrastRatio(v.mOnPrimary, v.mPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(deriveTokens(v, mode)["--vault-primary"]).toBeTruthy();
  });

  it("expands short hex and ignores invalid input", () => {
    expect(applyAccent(def.light, "#36c", "light").mPrimary).toBe("#3366cc");
    for (const bad of ["", "red", "#12", "nope"]) {
      expect(applyAccent(def.light, bad, "light")).toBe(def.light);
    }
    expect(snap("Default", "light", "bogus").accent).toBe("");
  });

  it.each(["#ffff00", "#ffffff", "#000000", "#808080", "#777777"])(
    "on-primary is readable on %s",
    (accent) => {
      for (const mode of MODES) {
        const t = deriveTokens(applyAccent(def[mode], accent, mode), mode);
        expect(
          contrastRatio(t["--vault-on-primary"], t["--vault-primary"]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

describe("resolveAccent", () => {
  it("reports an unchanged, contrasty accent", () => {
    const r = resolveAccent(def.light, "#1144aa", "light");
    expect(r.adjusted).toBe(false);
    expect(r.primary).toBe("#1144aa");
  });

  it.each(MODES)("nudges a near-surface accent in %s mode", (mode) => {
    const accent = def[mode].mSurface;
    const r = resolveAccent(def[mode], accent, mode);
    expect(r.adjusted).toBe(true);
    expect(r.primary).not.toBe(accent);
    expect(r.ratio).toBeGreaterThanOrEqual(3);
  });
});

describe("applyAppearance with an accent", () => {
  it("non-default theme follows the accent", () => {
    const s = snap("Dracula", "dark", "#ff8800");
    applyAppearance(document, s);
    const t = deriveTokens(s.variant, "dark");
    expect(root().style.getPropertyValue("--vault-primary")).toBe(
      t["--vault-primary"],
    );
    expect(root().style.getPropertyValue("--vault-bg")).toBe(t["--vault-bg"]);
  });

  it("stock Default touches only primary properties; clearing restores", () => {
    applyAppearance(document, snap("Default", "light", "#cc3366"));
    const set = Array.from({ length: root().style.length }, (_, i) =>
      root().style.item(i),
    );
    expect(set.length).toBeGreaterThan(0);
    for (const name of set) {
      expect(name).toMatch(
        /primary|brand|link-color|focus-highlight|select|logo|slider-track|icon-white/,
      );
    }
    expect(root().style.getPropertyValue("--vault-primary")).toMatch(/^#/);
    expect(root().style.getPropertyValue("--vault-bg")).toBe("");
    const css = document.getElementById(
      EXCALIDRAW_OVERRIDE_STYLE_ID,
    )?.textContent;
    expect(css).toContain("--color-primary");
    expect(css).not.toContain("--island-bg-color");
    expect(css).not.toContain("--text-primary-color");

    // Changing the accent re-applies; clearing removes everything.
    applyAppearance(document, snap("Default", "light", "#118833"));
    expect(root().style.getPropertyValue("--vault-primary")).not.toBe("");
    applyAppearance(document, snap("Default", "light", ""));
    expect(root().style.length).toBe(0);
    expect(document.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID)).toBeNull();
  });

  it("key includes the accent", () => {
    expect(snap("Default", "light", "#112233").key).not.toBe(
      snap("Default", "light", "").key,
    );
  });
});
