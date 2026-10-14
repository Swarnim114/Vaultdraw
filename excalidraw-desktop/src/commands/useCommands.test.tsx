import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPreferences } from "../vault/preferences";

import {
  setHotkeyOverride,
  useCommandDispatcher,
  useHotkeyOverrides,
} from "./useCommands";

const app = { vaultOpen: true, drawingOpen: false, writable: true };

afterEach(() => {
  window.localStorage.clear();
});

describe("useCommands", () => {
  it("overrides follow setHotkeyOverride (null removes)", () => {
    const { result } = renderHook(() => useHotkeyOverrides(window));
    expect(result.current).toEqual({});
    act(() => setHotkeyOverride("vault.newDrawing", ["Mod+Alt+N"], window));
    expect(result.current).toEqual({ "vault.newDrawing": ["Mod+Alt+N"] });
    expect(getPreferences(window).hotkeys).toEqual(result.current);
    act(() => setHotkeyOverride("vault.newDrawing", null, window));
    expect(result.current).toEqual({});
  });

  it("setting or resetting a command drops its legacy-id entry", () => {
    const { result } = renderHook(() => useHotkeyOverrides(window));
    act(() => setHotkeyOverride("palette.quickSwitcher", ["Mod+K"], window));
    act(() => setHotkeyOverride("palette.files", null, window));
    expect(result.current).toEqual({});
    act(() => setHotkeyOverride("palette.quickSwitcher", ["Mod+K"], window));
    act(() => setHotkeyOverride("palette.files", ["Mod+J"], window));
    expect(result.current).toEqual({ "palette.files": ["Mod+J"] });
  });

  it("dispatches keys through live handlers and honours rebinding", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }) =>
        useCommandDispatcher(document, window, {
          handlers: { "vault.newDrawing": handler },
          app,
        }),
      { initialProps: { handler: first } },
    );
    const press = (init: KeyboardEventInit) =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    const platformMeta = /mac|darwin/i.test(
      `${navigator.platform} ${navigator.userAgent}`,
    );
    const mod = platformMeta ? { metaKey: true } : { ctrlKey: true };
    press({ code: "KeyN", key: "n", ...mod });
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ handler: second });
    press({ code: "KeyN", key: "n", ...mod });
    expect(second).toHaveBeenCalledTimes(1);

    act(() => setHotkeyOverride("vault.newDrawing", ["Mod+Alt+N"], window));
    press({ code: "KeyN", key: "n", ...mod });
    expect(second).toHaveBeenCalledTimes(1);
    press({ code: "KeyN", key: "n", altKey: true, ...mod });
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("run/isAvailable check handler and when", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      useCommandDispatcher(document, window, {
        handlers: { "file.save": save, "settings.open": save },
        app,
      }),
    );
    expect(result.current.isAvailable("file.save")).toBe(false); // no drawing
    expect(result.current.run("file.save")).toBe(false);
    expect(result.current.isAvailable("settings.open")).toBe(true);
    expect(result.current.isAvailable("vault.switch")).toBe(false); // no handler
    expect(result.current.isAvailable("nope")).toBe(false);
    expect(result.current.run("settings.open")).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
