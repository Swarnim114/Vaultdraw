import { describe, expect, it } from "vitest";

import { clipboardColourProblem } from "./clipboardColours";

const theme = new Set(["#282a36", "#f8f8f2"]);

describe("clipboardColourProblem", () => {
  it("accepts the standard light drawing colour in light mode", () => {
    expect(clipboardColourProblem(["#ffffff", "#1e1e1e"], theme, false)).toBe(
      null,
    );
  });
  it("accepts the dark-filtered colour on #121212 in dark mode", () => {
    expect(clipboardColourProblem(["#121212", "#d3d3d3"], theme, true)).toBe(
      null,
    );
  });
  it("rejects the light colour in dark mode and theme colours anywhere", () => {
    expect(clipboardColourProblem(["#1e1e1e"], theme, true)).toMatch(/#d3d3d3/);
    expect(clipboardColourProblem(["#d3d3d3", "#282a36"], theme, true)).toMatch(
      /themed/,
    );
  });
});
