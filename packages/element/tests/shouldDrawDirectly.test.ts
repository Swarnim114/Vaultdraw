import { shouldDrawElementDirectly } from "../src/renderElement";

const el = (over: Record<string, unknown>) =>
  ({
    type: "arrow",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    ...over,
  } as any);

describe("shouldDrawElementDirectly", () => {
  it("draws unfilled arrows and lines directly", () => {
    for (const type of ["arrow", "line"]) {
      expect(shouldDrawElementDirectly(el({ type }), 1, true)).toBe(true);
    }
  });

  it("keeps bitmaps for shapes (dense bbox, costly to re-stroke)", () => {
    for (const type of ["rectangle", "diamond", "ellipse"]) {
      expect(shouldDrawElementDirectly(el({ type }), 1, true)).toBe(false);
    }
  });

  it("allows solid fills but not hachure-like fills", () => {
    const filled = { type: "line", backgroundColor: "#ffc9c9" };
    expect(
      shouldDrawElementDirectly(el({ ...filled, fillStyle: "solid" }), 1, true),
    ).toBe(true);
    for (const fillStyle of ["hachure", "cross-hatch", "zigzag"]) {
      expect(
        shouldDrawElementDirectly(el({ ...filled, fillStyle }), 1, true),
      ).toBe(false);
    }
  });

  it("keeps bitmaps for text, images, freedraw and other kinds", () => {
    for (const type of [
      "text",
      "image",
      "freedraw",
      "stickynote",
      "iframe",
      "embeddable",
      "frame",
    ]) {
      expect(shouldDrawElementDirectly(el({ type }), 1, true)).toBe(false);
    }
  });

  it("keeps the bitmap for translucent elements (single blend)", () => {
    expect(shouldDrawElementDirectly(el({}), 0.5, true)).toBe(false);
  });

  it("is off when the gate says the scene is too large", () => {
    expect(shouldDrawElementDirectly(el({}), 1, false)).toBe(false);
  });
});
