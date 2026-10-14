import { getDefaultAppState } from "../appState";

import {
  BACKGROUND_PATTERN_LIMITS,
  createBackgroundPattern,
  normalizeBackgroundPattern,
} from "./backgroundPattern";
import { serializeAsJSON } from "./json";
import { restoreAppState } from "./restore";

describe("normalizeBackgroundPattern", () => {
  it("keeps valid input", () => {
    const pattern = createBackgroundPattern("graph", { color: "#AABBCC" });
    expect(normalizeBackgroundPattern(pattern)).toEqual({
      ...pattern,
      color: "#aabbcc",
    });
  });

  it("returns null for junk", () => {
    for (const input of [null, undefined, 1, "grid", [], {}, { type: "x" }]) {
      expect(normalizeBackgroundPattern(input)).toBeNull();
    }
  });

  it("clamps numbers and falls back per field", () => {
    const pattern = normalizeBackgroundPattern({
      type: "grid",
      spacing: 9999,
      opacity: -3,
      majorEvery: 3.6,
      color: "red",
      marginLine: "yes",
    })!;
    expect(pattern.spacing).toBe(BACKGROUND_PATTERN_LIMITS.spacing.max);
    expect(pattern.opacity).toBe(BACKGROUND_PATTERN_LIMITS.opacity.min);
    expect(pattern.majorEvery).toBe(4);
    expect(pattern.color).toBeNull();
    expect(pattern.marginLine).toBe(false);
    expect(
      normalizeBackgroundPattern({ type: "dots", spacing: NaN })!.spacing,
    ).toBe(20);
  });
});

describe("restoreAppState", () => {
  it("defaults to no pattern and exporting it", () => {
    const state = restoreAppState({}, null);
    expect(state.viewBackgroundPattern).toBeNull();
    expect(state.exportBackgroundPattern).toBe(true);
  });

  it("round trips through the local file format", () => {
    const pattern = createBackgroundPattern("lines", { spacing: 40 });
    const json = serializeAsJSON(
      [],
      { ...getDefaultAppState(), viewBackgroundPattern: pattern },
      {},
      "local",
    );
    const parsed = JSON.parse(json);
    expect(parsed.appState.viewBackgroundPattern).toEqual(pattern);
    expect(
      restoreAppState(parsed.appState, null).viewBackgroundPattern,
    ).toEqual(pattern);
  });

  it("drops junk and bad flags", () => {
    const state = restoreAppState(
      {
        viewBackgroundPattern: { type: "nope" },
        exportBackgroundPattern: "x",
      } as any,
      null,
    );
    expect(state.viewBackgroundPattern).toBeNull();
    expect(state.exportBackgroundPattern).toBe(true);
  });
});
