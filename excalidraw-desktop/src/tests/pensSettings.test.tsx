/** Pens & laser settings: config mapping, normalization, UI, search. */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchSettings } from "../components/settings/schema";
import { SettingsModal } from "../components/settings/SettingsModal";
import { MAX_PEN_PRESETS, MAX_PEN_WIDTH } from "../pens/penPresets";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
  disposeSettings,
} from "../vault/settingsSync";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "v",
  name: "V",
  path: "/v",
  readOnly: false,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  disposeSettings();
  window.localStorage.clear();
});

describe("pens config mapping", () => {
  it("round-trips valid values and sends the presets array on change", () => {
    const presets = [
      {
        name: "A",
        color: "#fff",
        width: 2,
        opacity: 50,
        pressure: true,
        smoothing: 0.2,
        highlighter: false,
      },
    ];
    const { values, problems } = configToPreferences({
      pens: { presets },
      laser: { color: "blue", size: 4, decay_ms: 800, length: 30 },
    });
    expect(problems).toEqual([]);
    expect(values.penPresets).toEqual(presets);
    expect(values.laserSize).toBe(4);
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      ...values,
    });
    expect(changes).toContainEqual({ key: "pens.presets", value: presets });
    expect(changes).toContainEqual({ key: "laser.decay_ms", value: 800 });
  });

  it("fills partial hand-written presets with defaults", () => {
    const { values, problems } = configToPreferences({
      pens: { presets: [{ name: "Quick", color: "red", width: 1 }] },
    });
    expect(problems).toEqual([]);
    expect(values.penPresets).toEqual([
      {
        name: "Quick",
        color: "red",
        width: 1,
        opacity: 100,
        pressure: false,
        smoothing: 0.5,
        highlighter: false,
      },
    ]);
  });

  it("falls back with a readable problem on invalid values", () => {
    const { values, problems } = configToPreferences({
      pens: { presets: [{ name: "Bad", color: "red", width: 999 }] },
      laser: { size: 500, decay_ms: "slow", color: "#zz" },
    });
    expect(values.penPresets).toEqual(DEFAULT_PREFERENCES.penPresets);
    expect(values.laserSize).toBe(DEFAULT_PREFERENCES.laserSize);
    const msg = problems.find((p) => p.key === "pens.presets")!.message;
    expect(msg).toContain("pen 1 needs a width between");
    expect(problems.map((p) => p.key).sort()).toEqual(
      ["laser.color", "laser.decay_ms", "laser.size", "pens.presets"].sort(),
    );
  });

  it("rejects empty and oversized preset lists", () => {
    for (const presets of [
      [],
      Array(MAX_PEN_PRESETS + 1).fill({ name: "x", color: "red", width: 1 }),
    ]) {
      const { problems } = configToPreferences({ pens: { presets } });
      expect(problems[0].message).toContain("1 to 9 pens");
    }
  });

  it("normalizePreferences repairs stored values", () => {
    const p = normalizePreferences({ penPresets: "x", laserSize: 0 });
    expect(p.penPresets).toEqual(DEFAULT_PREFERENCES.penPresets);
    expect(p.laserSize).toBe(DEFAULT_PREFERENCES.laserSize);
  });
});

describe("settings search", () => {
  it("finds the pens and laser rows", () => {
    expect(searchSettings("highlighter").map((s) => s.id)).toContain(
      "pen-presets",
    );
    expect(searchSettings("laser").length).toBe(4);
    expect(searchSettings("alt+1").map((s) => s.id)).toContain("pen-presets");
  });
});

describe("Pens & laser page", () => {
  const open = () => {
    render(
      <SettingsModal
        vault={vault}
        onClose={() => {}}
        ownerDocument={document}
        initialPage="pens"
      />,
    );
  };

  it("adds, removes and resets pens, never removing the last", () => {
    open();
    const count = () => getPreferences(window).penPresets.length;
    const start = count();
    fireEvent.click(screen.getByRole("button", { name: "Add pen" }));
    expect(count()).toBe(start + 1);
    fireEvent.click(screen.getByRole("button", { name: "Remove pen 1" }));
    expect(count()).toBe(start);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(getPreferences(window).penPresets).toEqual(
      DEFAULT_PREFERENCES.penPresets,
    );
    while (count() > 1) {
      fireEvent.click(screen.getByRole("button", { name: "Remove pen 1" }));
    }
    expect(screen.getByRole("button", { name: "Remove pen 1" })).toBeDisabled();
  });

  it("disables Add pen at the maximum", () => {
    open();
    while (getPreferences(window).penPresets.length < MAX_PEN_PRESETS) {
      fireEvent.click(screen.getByRole("button", { name: "Add pen" }));
    }
    expect(screen.getByRole("button", { name: "Add pen" })).toBeDisabled();
  });

  it("clamps numeric input and persists only valid values", () => {
    open();
    const width = screen.getByLabelText("Pen 1 width");
    fireEvent.change(width, { target: { value: "999" } });
    fireEvent.blur(width);
    expect(getPreferences(window).penPresets[0].width).toBe(MAX_PEN_WIDTH);
    const opacity = screen.getByLabelText("Pen 1 opacity");
    fireEvent.change(opacity, { target: { value: "abc" } });
    fireEvent.blur(opacity);
    expect(getPreferences(window).penPresets[0].opacity).toBe(100);
    const size = screen.getByLabelText("Laser size");
    fireEvent.change(size, { target: { value: "0" } });
    fireEvent.blur(size);
    expect(getPreferences(window).laserSize).toBe(1);
  });

  it("edits toggles and resets the laser", () => {
    open();
    fireEvent.click(screen.getByLabelText("Pen 1 highlighter"));
    expect(getPreferences(window).penPresets[0].highlighter).toBe(true);
    const fade = screen.getByLabelText("Laser fade time");
    fireEvent.change(fade, { target: { value: "2000" } });
    fireEvent.blur(fade);
    expect(getPreferences(window).laserDecayMs).toBe(2000);
    fireEvent.click(screen.getByRole("button", { name: "Reset laser" }));
    expect(getPreferences(window).laserDecayMs).toBe(
      DEFAULT_PREFERENCES.laserDecayMs,
    );
  });
});
