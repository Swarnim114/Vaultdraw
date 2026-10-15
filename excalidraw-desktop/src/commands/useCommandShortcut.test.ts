import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setHotkeyOverride } from "./useCommands";
import { useCommandShortcut } from "./useCommandShortcut";

afterEach(() => window.localStorage.clear());

describe("useCommandShortcut", () => {
  it("shows the default binding with the platform's label", () => {
    const { result } = renderHook(() => useCommandShortcut("settings.open"));
    expect(result.current).toMatch(/^(⌘,|Ctrl\+,)$/);
  });

  it("follows a custom binding live and an explicit unassign", () => {
    const { result } = renderHook(() => useCommandShortcut("settings.open"));
    act(() => setHotkeyOverride("settings.open", ["Mod+Alt+P"], window));
    expect(result.current).toMatch(/^(⌥⌘P|Ctrl\+Alt\+P)$/);
    act(() => setHotkeyOverride("settings.open", [], window));
    expect(result.current).toBe("");
  });

  it("is empty for commands without keys and unknown ids", () => {
    expect(
      renderHook(() => useCommandShortcut("file.saveCopy")).result.current,
    ).toBe("");
    expect(renderHook(() => useCommandShortcut("nope")).result.current).toBe(
      "",
    );
  });
});
