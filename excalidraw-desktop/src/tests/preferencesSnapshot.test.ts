import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  attachPreferencesStore,
  detachPreferencesStore,
  getPreferences,
  replaceStoredPreferences,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

const STORAGE_KEY = "excalidraw-vault-preferences-v1";
const mutable = (v: unknown) => v as any;

afterEach(() => {
  detachPreferencesStore();
  window.localStorage.clear();
});

describe.each([
  ["memory store", () => attachPreferencesStore(DEFAULT_PREFERENCES, () => {})],
  ["localStorage", () => detachPreferencesStore()],
])("preferences snapshot (%s)", (_name, setup) => {
  const win = window;

  it("keeps identity across reads and is deeply frozen", () => {
    setup();
    updatePreferences({ recentVaults: ["/a"], hotkeys: { x: ["k"] } }, win);
    const a = getPreferences(win);
    expect(getPreferences(win)).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => {
      mutable(a).theme = "dark";
    }).toThrow(TypeError);
    expect(() => mutable(a.recentVaults).push("/b")).toThrow(TypeError);
    expect(() => {
      mutable(a.hotkeys).y = [];
    }).toThrow(TypeError);
    expect(() => mutable(a.hotkeys.x).push("z")).toThrow(TypeError);
    expect(() => (mutable(a.penPresets[0]).name = "n")).toThrow(TypeError);
    expect(Object.isFrozen(a.toolRectangle)).toBe(true);
  });

  it("does not freeze or retain the caller's objects", () => {
    setup();
    const list = ["/a"];
    updatePreferences({ recentVaults: list }, win);
    list.push("/b");
    expect(getPreferences(win).recentVaults).toEqual(["/a"]);
  });

  it("new identity per change, nested objects shared when unchanged", () => {
    setup();
    const a = getPreferences(win);
    const b = updatePreferences({ recentVaults: ["/a"] }, win);
    expect(b).not.toBe(a);
    expect(getPreferences(win)).toBe(b);
    expect(b.penPresets).toBe(a.penPresets);
    expect(b.hotkeys).toBe(a.hotkeys);
    expect(b.recentVaults).not.toBe(a.recentVaults);
    const c = updatePreferences({ theme: "dark" }, win);
    expect(c).not.toBe(b);
    expect(c.recentVaults).toBe(b.recentVaults);
  });

  it("an update that changes nothing keeps the snapshot", () => {
    setup();
    const a = updatePreferences({ recentVaults: ["/a"] }, win);
    const b = updatePreferences({ recentVaults: ["/a"] }, win);
    expect(b).toBe(a);
  });

  it("notifies once per update", () => {
    setup();
    const spy = vi.fn();
    const off = subscribePreferences(spy);
    updatePreferences({ theme: "dark" }, win);
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("memory store", () => {
  it("persist receives the next and prev snapshots", () => {
    const persist = vi.fn();
    attachPreferencesStore(DEFAULT_PREFERENCES, persist);
    const prev = getPreferences();
    const next = updatePreferences({ theme: "dark" });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0]).toBe(next);
    expect(persist.mock.calls[0][1]).toBe(prev);
    expect(prev.theme).not.toBe("dark");
    expect(next.theme).toBe("dark");
  });

  it("live reload (replace) notifies and returns new values with sharing", () => {
    attachPreferencesStore(DEFAULT_PREFERENCES, () => {});
    const before = getPreferences();
    const spy = vi.fn();
    subscribePreferences(spy);
    replaceStoredPreferences({
      ...before,
      theme: "dark",
      hotkeys: { a: ["b"] },
    });
    const after = getPreferences();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(after).not.toBe(before);
    expect(after.theme).toBe("dark");
    expect(after.hotkeys).toEqual({ a: ["b"] });
    expect(after.penPresets).toBe(before.penPresets);
    expect(Object.isFrozen(after.hotkeys)).toBe(true);
    // identical replace: same snapshot, still notifies
    replaceStoredPreferences({ ...after });
    expect(getPreferences()).toBe(after);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("attach and detach switch the backing store", () => {
    attachPreferencesStore({ ...DEFAULT_PREFERENCES, theme: "dark" }, () => {});
    const a = getPreferences();
    expect(a.theme).toBe("dark");
    attachPreferencesStore(
      { ...DEFAULT_PREFERENCES, theme: "light" },
      () => {},
    );
    expect(getPreferences().theme).toBe("light");
    detachPreferencesStore();
    expect(getPreferences(window).theme).toBe(DEFAULT_PREFERENCES.theme);
  });
});

describe("localStorage mode", () => {
  it("detects an external change and shares unchanged parts", () => {
    updatePreferences({ autosaveDelayMs: 1500 }, window);
    const a = getPreferences(window);
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...raw, autosaveDelayMs: 2500 }),
    );
    const b = getPreferences(window);
    expect(b).not.toBe(a);
    expect(b.autosaveDelayMs).toBe(2500);
    expect(b.penPresets).toBe(a.penPresets);
    expect(getPreferences(window)).toBe(b);
  });

  it("returns one stable defaults snapshot when storage is empty or bad", () => {
    const a = getPreferences(window);
    expect(getPreferences(window)).toBe(a);
    window.localStorage.setItem(STORAGE_KEY, "{nope");
    expect(getPreferences(window)).toBe(a);
  });
});
