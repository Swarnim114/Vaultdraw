import { invertImageDataForDarkTheme } from "../src/darkThemePixels";

const run = (r: number, g: number, b: number, a = 255) => {
  const d = new Uint8ClampedArray([r, g, b, a]);
  invertImageDataForDarkTheme(d);
  return Array.from(d);
};

describe("invertImageDataForDarkTheme", () => {
  it("maps #1e1e1e to a light grey", () => {
    // 30 -> 0.14*30+... : -0.86*30+237.15 = 211.35 (grey: matrix rows sum to 1)
    expect(run(30, 30, 30)).toEqual([211, 211, 211, 255]);
  });

  it("maps white to near black and black to near white", () => {
    expect(run(255, 255, 255)).toEqual([18, 18, 18, 255]);
    expect(run(0, 0, 0)).toEqual([237, 237, 237, 255]);
  });

  it("matches the CSS filter for red and keeps its hue", () => {
    // invert(93%) -> (17.85, 237.15, 237.15), then hue-rotate(180deg), clamped
    const [r, g, b] = run(255, 0, 0);
    expect([r, g, b]).toEqual([255, 144, 144]);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it("matches the CSS filter for a known colour", () => {
    expect(run(0, 128, 255)).toEqual([48, 158, 255, 255]);
  });

  it("leaves alpha untouched", () => {
    expect(run(10, 200, 30, 77)[3]).toBe(77);
  });
});
