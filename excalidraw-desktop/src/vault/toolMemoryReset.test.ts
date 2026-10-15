import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearAllToolMemory,
  getToolMemory,
  rememberToolStyle,
} from "../toolDefaults/toolMemory";
import { toolField } from "../toolDefaults/toolStyles";

import { updatePreferences } from "./preferences";
import { disposeSettings } from "./settingsSync";
import {
  attachVaultSettings,
  detachVaultSettings,
  setVaultOverride,
} from "./vaultSettings";

// importing the store installs the watcher
import "./toolDefaultsStore";

beforeEach(() => {
  window.localStorage.clear();
  clearAllToolMemory();
});
afterEach(() => {
  detachVaultSettings();
  disposeSettings();
  window.localStorage.clear();
});

describe("tool memory reset on default changes", () => {
  it("forgets only the tool whose effective default changed", () => {
    rememberToolStyle("arrow", { stroke_color: "#e03131" });
    rememberToolStyle("line", { stroke_color: "#e03131" });
    updatePreferences(
      { [toolField("arrow")]: { stroke_color: "#f08c00" } },
      undefined,
    );
    expect(getToolMemory("arrow")).toBeUndefined();
    expect(getToolMemory("line")).toBeDefined();
  });

  it("is untouched by edits that leave the defaults alone", () => {
    updatePreferences(
      { [toolField("arrow")]: { stroke_color: "#f08c00" } },
      undefined,
    );
    rememberToolStyle("arrow", { stroke_color: "#e03131" });
    updatePreferences(
      { [toolField("arrow")]: { stroke_color: "#f08c00" } },
      undefined,
    );
    updatePreferences({ zoom: 1.5 } as never, undefined);
    expect(getToolMemory("arrow")).toBeDefined();
  });

  it("forgets when the This vault override changes the effective default", async () => {
    attachVaultSettings(window, "h", { tauri: false });
    rememberToolStyle("text", { font_size: 40 });
    await setVaultOverride(toolField("text"), { font_size: 20 });
    expect(getToolMemory("text")).toBeUndefined();
  });
});
