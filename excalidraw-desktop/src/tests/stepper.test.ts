import { describe, expect, it } from "vitest";

import { stepValue } from "../components/settings/stepper";

const range = { min: 200, max: 2000, step: 50 };

describe("stepValue", () => {
  it("moves one step on the grid", () => {
    expect(stepValue(500, 1, range)).toBe(550);
    expect(stepValue(500, -1, range)).toBe(450);
  });

  it("clamps at both ends", () => {
    expect(stepValue(2000, 1, range)).toBe(2000);
    expect(stepValue(200, -1, range)).toBe(200);
    expect(stepValue(1990, 1, range)).toBe(2000);
  });

  it("lands an off-grid value on the grid first", () => {
    expect(stepValue(520, 1, range)).toBe(550);
    expect(stepValue(520, -1, range)).toBe(500);
    expect(stepValue(80, 1, range)).toBe(200);
  });
});
