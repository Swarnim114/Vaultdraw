/**
 * Dependency-free colour maths for the theme engine.
 *
 * - Hex parsing/formatting (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`).
 * - sRGB <-> OKLab <-> OKLCH (Björn Ottosson's matrices), with gamut mapping
 *   by chroma reduction so every OKLCH colour round-trips to a valid hex.
 * - Perceptual mixing, WCAG 2.x contrast and a contrast "nudger".
 *
 * All public helpers take and return lowercase `#rrggbb` strings unless
 * documented otherwise.
 */

export type Rgb = { r: number; g: number; b: number };
export type Rgba = Rgb & { a: number };
export type Oklab = { l: number; a: number; b: number };
export type Oklch = { l: number; c: number; h: number };

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (case-insensitive) into 0..1 channels. */
export const parseHex = (input: string): Rgba | null => {
  if (typeof input !== "string") {
    return null;
  }
  const s = input.trim();
  const m = HEX_RE.exec(s);
  if (!m) {
    return null;
  }
  let hex = m[1].toLowerCase();
  if (hex.length <= 4) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return {
    r: n(0),
    g: n(2),
    b: n(4),
    a: hex.length === 8 ? n(6) : 1,
  };
};

export const isHexColor = (input: unknown): input is string =>
  typeof input === "string" && parseHex(input) !== null;

const byte = (v: number) =>
  Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, "0");

/** Formats channels (0..1) as lowercase `#rrggbb` (or `#rrggbbaa` when alpha < 1 and `withAlpha`). */
export const formatHex = (c: Rgb | Rgba, withAlpha = false): string => {
  const base = `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`;
  if (withAlpha && "a" in c && c.a < 1) {
    return `${base}${byte(c.a)}`;
  }
  return base;
};

/** Normalises any accepted hex form to lowercase `#rrggbb` (alpha dropped). Returns null when invalid. */
export const normalizeHex = (input: string): string | null => {
  const rgba = parseHex(input);
  return rgba ? formatHex(rgba) : null;
};

/** Like normalizeHex but throws on invalid input (internal convenience). */
const hex6 = (input: string): Rgb => {
  const rgba = parseHex(input);
  if (!rgba) {
    throw new Error(`Invalid colour "${input}"`);
  }
  return rgba;
};

// ---------------------------------------------------------------------------
// sRGB <-> linear <-> OKLab <-> OKLCH
// ---------------------------------------------------------------------------

export const srgbToLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

export const linearToSrgb = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

export const rgbToOklab = ({ r, g, b }: Rgb): Oklab => {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

/** OKLab -> sRGB (0..1, NOT clamped; may be out of gamut). */
export const oklabToRgbUnclamped = ({ l, a, b }: Oklab): Rgb => {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  const lr = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const lb = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
  const enc = (v: number) => (v < 0 ? -linearToSrgb(-v) : linearToSrgb(v));
  return { r: enc(lr), g: enc(lg), b: enc(lb) };
};

const inGamut = ({ r, g, b }: Rgb, eps = 1e-4) =>
  r >= -eps &&
  r <= 1 + eps &&
  g >= -eps &&
  g <= 1 + eps &&
  b >= -eps &&
  b <= 1 + eps;

export const oklabToOklch = ({ l, a, b }: Oklab): Oklch => {
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) {
    h += 360;
  }
  return { l, c, h: c < 1e-6 ? 0 : h };
};

export const oklchToOklab = ({ l, c, h }: Oklch): Oklab => {
  const rad = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
};

/** OKLCH -> in-gamut sRGB, reducing chroma (keeping L and h) when needed. */
export const oklchToRgb = (lch: Oklch): Rgb => {
  const l = clamp01(lch.l);
  const direct = oklabToRgbUnclamped(oklchToOklab({ ...lch, l }));
  if (inGamut(direct)) {
    return { r: clamp01(direct.r), g: clamp01(direct.g), b: clamp01(direct.b) };
  }
  let lo = 0;
  let hi = lch.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToRgbUnclamped(oklchToOklab({ l, c: mid, h: lch.h })))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const rgb = oklabToRgbUnclamped(oklchToOklab({ l, c: lo, h: lch.h }));
  return { r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b) };
};

export const hexToOklab = (hex: string): Oklab => rgbToOklab(hex6(hex));
export const hexToOklch = (hex: string): Oklch => oklabToOklch(hexToOklab(hex));
export const oklabToHex = (lab: Oklab): string => oklchToHex(oklabToOklch(lab));
export const oklchToHex = (lch: Oklch): string => formatHex(oklchToRgb(lch));

// ---------------------------------------------------------------------------
// Mixing & manipulation
// ---------------------------------------------------------------------------

/** Mix `a` towards `b` by `t` (0 = a, 1 = b) in OKLab (perceptually even, no hue artefacts for greys). */
export const mix = (a: string, b: string, t: number): string => {
  const A = hexToOklab(a);
  const B = hexToOklab(b);
  const k = clamp01(t);
  return oklabToHex({
    l: A.l + (B.l - A.l) * k,
    a: A.a + (B.a - A.a) * k,
    b: A.b + (B.b - A.b) * k,
  });
};

/** Mix in OKLCH along the shortest hue arc (keeps chroma between two saturated colours). */
export const mixOklch = (a: string, b: string, t: number): string => {
  const A = hexToOklch(a);
  const B = hexToOklch(b);
  const k = clamp01(t);
  let dh = B.h - A.h;
  if (dh > 180) {
    dh -= 360;
  } else if (dh < -180) {
    dh += 360;
  }
  // Greys have no meaningful hue: borrow the other colour's.
  const hA = A.c < 0.02 ? B.h : A.h;
  const hB = B.c < 0.02 ? A.h : B.h;
  const h = A.c < 0.02 || B.c < 0.02 ? hA + (hB - hA) * k : A.h + dh * k;
  return oklchToHex({
    l: A.l + (B.l - A.l) * k,
    c: A.c + (B.c - A.c) * k,
    h: ((h % 360) + 360) % 360,
  });
};

/** Euclidean distance in OKLab (≈ perceptual difference; 0.02 is a just-visible step). */
export const oklabDistance = (a: string, b: string): number => {
  const A = hexToOklab(a);
  const B = hexToOklab(b);
  return Math.hypot(A.l - B.l, A.a - B.a, A.b - B.b);
};

/**
 * Moves `from` towards `to` until the OKLab distance equals `distance`
 * (or reaches `to` when it is closer than that).
 */
export const stepToward = (from: string, to: string, distance: number) => {
  const d = oklabDistance(from, to);
  if (d <= 1e-9) {
    return normalizeHex(from) as string;
  }
  return mix(from, to, Math.min(1, distance / d));
};

export const withLightness = (hex: string, l: number): string => {
  const lch = hexToOklch(hex);
  return oklchToHex({ ...lch, l: clamp01(l) });
};

export const adjustLightness = (hex: string, delta: number): string => {
  const lch = hexToOklch(hex);
  return oklchToHex({ ...lch, l: clamp01(lch.l + delta) });
};

export const rotateHue = (hex: string, degrees: number): string => {
  const lch = hexToOklch(hex);
  return oklchToHex({ ...lch, h: (((lch.h + degrees) % 360) + 360) % 360 });
};

/** `rgba(r, g, b, a)` CSS string (for shadows / overlays). */
export const toRgba = (hex: string, alpha: number): string => {
  const { r, g, b } = hex6(hex);
  const ch = (v: number) => Math.round(clamp01(v) * 255);
  return `rgba(${ch(r)}, ${ch(g)}, ${ch(b)}, ${+alpha.toFixed(3)})`;
};

/**
 * The opaque colour a browser paints for `fg` at `alpha` over `bg` (CSS
 * source-over in gamma sRGB). Used to check text contrast on translucent
 * state tints such as `--vault-sel`.
 */
export const blendOver = (fg: string, alpha: number, bg: string): string => {
  const f = hex6(fg);
  const b = hex6(bg);
  const k = clamp01(alpha);
  return formatHex({
    r: f.r * k + b.r * (1 - k),
    g: f.g * k + b.g * (1 - k),
    b: f.b * k + b.b * (1 - k),
  });
};

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

export const relativeLuminance = (hex: string): number => {
  const { r, g, b } = hex6(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
};

/** WCAG 2.x contrast ratio (1..21). Alpha is ignored. */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

export const isDark = (hex: string) => hexToOklab(hex).l < 0.6;

/** Whichever of white/black reads better on `bg`. */
export const bestExtreme = (bg: string): string =>
  contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg)
    ? "#ffffff"
    : "#000000";

/**
 * Returns `fg` unchanged when it already reaches `min` contrast on `bg`;
 * otherwise moves its OKLCH lightness (hue and chroma kept, gamut-mapped)
 * the smallest amount that passes. Tries the direction away from `bg` first,
 * then the other one; falls back to white/black if neither can reach `min`.
 */
export const ensureContrast = (fg: string, bg: string, min: number): string => {
  const fgHex = normalizeHex(fg) ?? "#000000";
  if (contrastRatio(fgHex, bg) >= min) {
    return fgHex;
  }
  const lch = hexToOklch(fgHex);
  const lighterFirst =
    contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg);
  for (const target of lighterFirst ? [1, 0] : [0, 1]) {
    const at = (t: number) =>
      oklchToHex({ ...lch, l: lch.l + (target - lch.l) * t });
    if (contrastRatio(at(1), bg) < min) {
      continue;
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(at(mid), bg) >= min) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    // Rounding to 8-bit can land just under; creep forward until it passes.
    let t = hi;
    let out = at(t);
    while (contrastRatio(out, bg) < min && t < 1) {
      t = Math.min(1, t + 0.005);
      out = at(t);
    }
    return out;
  }
  return bestExtreme(bg);
};

/** ensureContrast against several (similar) backgrounds at once. */
export const ensureContrastAll = (
  fg: string,
  bgs: readonly string[],
  min: number,
): string => {
  let cur = normalizeHex(fg) ?? "#000000";
  for (let i = 0; i < 8; i++) {
    let worst: string | null = null;
    let worstRatio = Infinity;
    for (const bg of bgs) {
      const r = contrastRatio(cur, bg);
      if (r < worstRatio) {
        worstRatio = r;
        worst = bg;
      }
    }
    if (worst === null || worstRatio >= min) {
      return cur;
    }
    cur = ensureContrast(cur, worst, min);
  }
  for (const ext of ["#ffffff", "#000000"]) {
    if (bgs.every((bg) => contrastRatio(ext, bg) >= min)) {
      return ext;
    }
  }
  return cur;
};

/** The candidate with the best contrast on `bg`, nudged to reach `min` if necessary. */
export const pickOn = (
  bg: string,
  candidates: readonly string[],
  min: number,
): string => {
  for (const c of candidates) {
    if (contrastRatio(c, bg) >= min) {
      return normalizeHex(c) as string;
    }
  }
  let best = candidates[0];
  for (const c of candidates) {
    if (contrastRatio(c, bg) > contrastRatio(best, bg)) {
      best = c;
    }
  }
  return ensureContrast(best, bg, min);
};
