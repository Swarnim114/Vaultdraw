// Vaultdraw: Safari/WebKit has no CanvasRenderingContext2D.filter, so the
// dark-theme image filter (DARK_THEME_FILTER = "invert(93%)
// hue-rotate(180deg)") is applied per pixel here instead. A plain RGB invert
// would flip hue; this reproduces the CSS Filter Effects maths exactly.

const INVERT = 0.93;
const SLOPE = 1 - 2 * INVERT; // invert(a): c' = c * (1 - 2a) + 255a
const OFFSET = 255 * INVERT;

// hue-rotate(180deg) matrix (cos = -1, sin = 0), CSS Filter Effects spec
const M = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

// fold both steps into one affine map: out = K * in + B (no per-pixel trig)
const K = M.map(([a, b, c]) => [a * SLOPE, b * SLOPE, c * SLOPE]);
const B = M.map(([a, b, c]) => (a + b + c) * OFFSET);

/** Applies the dark-theme filter to RGBA pixels in place; alpha untouched. */
export const invertImageDataForDarkTheme = (data: Uint8ClampedArray) => {
  const [k0, k1, k2] = K;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Uint8ClampedArray clamps to 0..255 and rounds on assignment
    data[i] = k0[0] * r + k0[1] * g + k0[2] * b + B[0];
    data[i + 1] = k1[0] * r + k1[1] * g + k1[2] * b + B[1];
    data[i + 2] = k2[0] * r + k2[1] * g + k2[2] * b + B[2];
  }
};
