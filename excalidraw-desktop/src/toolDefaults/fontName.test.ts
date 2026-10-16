import { describe, expect, it } from "vitest";

import { defaultFontLabel, fontName } from "./fontName";

describe("fontName", () => {
  it("maps ids to Excalidraw names", () => {
    expect(fontName(3)).toBe("Cascadia");
    expect(fontName(5)).toBe("Excalifont");
    expect(fontName(10)).toBe("Assistant");
    expect(fontName(8)).toBe("Comic Shanns");
  });

  it("falls back to the id and builds the default label", () => {
    expect(fontName(99)).toBe("99");
    expect(defaultFontLabel(3)).toBe("Default (Cascadia)");
  });
});
