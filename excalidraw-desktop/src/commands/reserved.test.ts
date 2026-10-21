import { describe, expect, it } from "vitest";

import { reservedReason } from "./reserved";

describe("reservedReason", () => {
  it.each([
    ["Mod+Q", "mac"],
    ["Cmd+Shift+W", "mac"],
    ["Mod+H", "mac"],
    ["Mod+Alt+H", "mac"],
    ["Mod+M", "mac"],
    ["Mod+Tab", "mac"],
    ["Mod+Space", "mac"],
    ["Mod+Ctrl+Space", "mac"],
    ["Mod+Backquote", "mac"],
    ["Mod+Alt+Escape", "mac"],
    ["Mod+Ctrl+Q", "mac"],
    ["Mod+Ctrl+F", "mac"],
    ["Mod+Shift+3", "mac"],
    ["Mod+Shift+4", "mac"],
    ["Mod+Shift+5", "mac"],
    ["Alt+F4", "win"],
    ["Alt+F4", "linux"],
    ["Alt+Tab", "win"],
    ["Mod+Alt+Delete", "win"],
    ["Meta+E", "win"],
    ["Meta+Shift+S", "linux"],
    ["Mod+C", "mac"],
    ["Mod+X", "win"],
    ["Ctrl+V", "linux"],
    ["Mod+Z", "mac"],
    ["Mod+A", "win"],
    ["Mod+Shift+Z", "linux"],
  ] as const)("refuses %s on %s", (chord, platform) => {
    expect(reservedReason(chord, platform)).toEqual(expect.any(String));
  });

  it.each([
    ["Mod+S", "mac"],
    ["Mod+N", "win"],
    ["Mod+Q", "win"],
    ["Mod+P", "linux"],
    ["Alt+F4", "mac"],
    ["Mod+Shift+F", "mac"],
    ["Ctrl+Q", "mac"],
    ["Mod+Comma", "mac"],
    ["Mod+W", "mac"],
  ] as const)("allows %s on %s", (chord, platform) => {
    expect(reservedReason(chord, platform)).toBeNull();
  });
});
