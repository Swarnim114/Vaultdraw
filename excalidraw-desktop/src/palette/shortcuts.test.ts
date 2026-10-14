import { describe, expect, it } from "vitest";

import { commandShortcutLabel, excalidrawShortcutLabel } from "./shortcuts";

describe("palette shortcut labels", () => {
  it("formats registry commands with overrides", () => {
    expect(commandShortcutLabel("vault.newDrawing", {}, "mac")).toBe("⌘N");
    expect(
      commandShortcutLabel("vault.newDrawing", { "vault.newDrawing": [] }, "mac"),
    ).toBe("");
    expect(
      commandShortcutLabel(
        "vault.newDrawing",
        { "vault.newDrawing": ["Mod+Alt+K"] },
        "win",
      ),
    ).toBe("Ctrl+Alt+K");
    expect(commandShortcutLabel("nope", {}, "mac")).toBe("");
  });

  it("converts Excalidraw's display shortcuts", () => {
    expect(excalidrawShortcutLabel("Cmd+Shift+L", "mac")).toBe("⇧⌘L");
    expect(excalidrawShortcutLabel("Ctrl+G", "win")).toBe("Ctrl+G");
    expect(excalidrawShortcutLabel("Shift+Option+D", "mac")).toBe("⌥⇧D");
    expect(excalidrawShortcutLabel("R", "mac")).toBe("R");
    expect(excalidrawShortcutLabel(null, "mac")).toBe("");
    expect(excalidrawShortcutLabel("Space+drag", "mac")).toBe("Space+drag");
  });
});
