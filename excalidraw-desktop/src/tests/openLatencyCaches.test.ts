import { afterEach, describe, expect, it } from "vitest";

import { getBuiltinTheme, resolveAccent } from "../theme";
import { prepareDrawings } from "../palette/rank";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreferences,
} from "../vault/preferences";

const STORAGE_KEY = "excalidraw-vault-preferences-v1";

describe("getPreferences localStorage cache", () => {
  afterEach(() => window.localStorage.clear());

  it("returns a fresh object each call (cached value can't be mutated)", () => {
    updatePreferences({ autosaveDelayMs: 1234 }, window);
    const a = getPreferences(window);
    a.autosaveDelayMs = 1;
    a.recentVaults.push("/mutated");
    a.hotkeys.x = ["y"];
    const b = getPreferences(window);
    expect(b).not.toBe(a);
    expect(b.autosaveDelayMs).toBe(1234);
    expect(b.recentVaults).not.toContain("/mutated");
    expect(b.hotkeys.x).toBeUndefined();
  });

  it("sees a direct localStorage change (keyed by the raw string)", () => {
    updatePreferences({ autosaveDelayMs: 1500 }, window);
    expect(getPreferences(window).autosaveDelayMs).toBe(1500);
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...raw, autosaveDelayMs: 2500 }),
    );
    expect(getPreferences(window).autosaveDelayMs).toBe(2500);
  });

  it("falls back to defaults for missing or unreadable storage", () => {
    expect(getPreferences(window)).toEqual(DEFAULT_PREFERENCES);
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getPreferences(window)).toEqual(DEFAULT_PREFERENCES);
    window.localStorage.setItem(STORAGE_KEY, "null");
    expect(getPreferences(window)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("resolveAccent cache", () => {
  const variant = getBuiltinTheme("default")!.dark;

  it("returns the same result for the same inputs and differs per accent/mode", () => {
    const a = resolveAccent(variant, "#3b7fe0", "dark");
    expect(resolveAccent(variant, "#3b7fe0", "dark")).toBe(a);
    expect(resolveAccent(variant, "#e05a5a", "dark").primary).not.toBe(
      a.primary,
    );
    expect(resolveAccent(variant, "", "dark")).toEqual(
      resolveAccent({ ...variant }, "", "dark"),
    );
  });

  it("stays correct past the per-variant bound", () => {
    const first = resolveAccent(variant, "#3b7fe0", "dark");
    for (let i = 0; i < 40; i++) {
      resolveAccent(variant, `#1020${(i + 16).toString(16)}`, "dark");
    }
    expect(resolveAccent(variant, "#3b7fe0", "dark")).toEqual(first);
  });
});

describe("prepareDrawings reuse", () => {
  it("reuses the index for an equal path list, rebuilds for a changed one", () => {
    const first = prepareDrawings(["a.excalidraw", "b.excalidraw"]);
    expect(prepareDrawings(["a.excalidraw", "b.excalidraw"], first)).toBe(
      first,
    );
    const next = prepareDrawings(["a.excalidraw", "c.excalidraw"], first);
    expect(next).not.toBe(first);
    expect(next.list.map((d) => d.path)).toEqual([
      "a.excalidraw",
      "c.excalidraw",
    ]);
    // Unchanged entries keep their prepared state.
    expect(next.byPath.get("a.excalidraw")).toBe(
      first.byPath.get("a.excalidraw"),
    );
    expect(prepareDrawings(["a.excalidraw"], next).list).toHaveLength(1);
  });
});
