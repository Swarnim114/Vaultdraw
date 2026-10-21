import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import type { ExcalidrawElement, ExcalidrawLineElement } from "./types";

/**
 * Geo shapes are ordinary closed line elements (`polygon: true`, roundness
 * null) carrying a marker in `customData`. Files stay compatible with
 * excalidraw.com, which just draws the line. This module is pure geometry and
 * registry: no editor, renderer or binding wiring.
 */

export type GeoShapeKind =
  | "triangle"
  | "hexagon"
  | "parallelogram"
  | "star"
  | "cylinder"
  | "cloud";

export type GeoShapeCategory =
  | "basic"
  | "flowchart"
  | "arrows"
  | "callouts"
  | "stars";

export type GeoShapeParams = Record<string, number>;

export const GEO_SHAPE_MARKER_KEY = "vaultdrawShape";

export type GeoShapeMarker = {
  kind: GeoShapeKind;
  v: 1;
  params: GeoShapeParams;
  /** Set when the points were edited elsewhere (D9): behaves as a plain line */
  detached?: true;
};

export type GeoTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GeoKindDef = {
  id: GeoShapeKind;
  label: string;
  category: GeoShapeCategory;
  /** search words for the picker / palette */
  aliases: string;
  defaultParams: GeoShapeParams;
  /** closed outline inside [0,w]x[0,h]; last point equals the first */
  generate: (w: number, h: number, params?: unknown) => LocalPoint[];
  /** inscribed label rectangle, in box coordinates */
  textBox: (w: number, h: number, params?: unknown) => GeoTextBox;
};

// ---- point budgets (render cost) ------------------------------------------
export const CYLINDER_ARC_SEGMENTS = 16; // per half ellipse
export const CLOUD_BUMP_SEGMENTS = 6; // per bump; 9 bumps -> 55 points

// ---- helpers --------------------------------------------------------------

type ParamSpec = Record<
  string,
  { default: number; min: number; max: number; integer?: boolean }
>;

const MIN_SIZE = 1;
const clampSize = (n: number) =>
  Number.isFinite(n) ? Math.max(MIN_SIZE, n) : MIN_SIZE;

const P = (x: number, y: number) => pointFrom<LocalPoint>(x, y);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const resolveParams = (spec: ParamSpec, raw: unknown): GeoShapeParams => {
  const out: GeoShapeParams = {};
  const src = isPlainObject(raw) ? raw : {};
  for (const key of Object.keys(spec)) {
    const s = spec[key];
    let v = Object.prototype.hasOwnProperty.call(src, key)
      ? src[key]
      : undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      v = s.default;
    }
    let n = Math.min(s.max, Math.max(s.min, v as number));
    if (s.integer) {
      n = Math.round(n);
    }
    out[key] = n;
  }
  return out;
};

/** Close a ring (last == first) */
const closed = (pts: LocalPoint[]): LocalPoint[] => {
  pts.push(P(pts[0][0], pts[0][1]));
  return pts;
};

type RawKind = {
  id: GeoShapeKind;
  label: string;
  category: GeoShapeCategory;
  aliases: string;
  params?: ParamSpec;
  generate: (w: number, h: number, p: GeoShapeParams) => LocalPoint[];
  textBox: (w: number, h: number, p: GeoShapeParams) => GeoTextBox;
};

/** Adds param sanitising and box clamping once, so kinds stay tiny */
const defineKind = (k: RawKind): GeoKindDef => {
  const spec = k.params ?? {};
  return {
    id: k.id,
    label: k.label,
    category: k.category,
    aliases: k.aliases,
    defaultParams: resolveParams(spec, undefined),
    generate: (w, h, params) =>
      k.generate(clampSize(w), clampSize(h), resolveParams(spec, params)),
    textBox: (w, h, params) =>
      k.textBox(clampSize(w), clampSize(h), resolveParams(spec, params)),
  };
};

/** Scales a unit-space ring so its bounds fill [0,w]x[0,h] exactly. */
const fitToBox = (
  unit: [number, number][],
  w: number,
  h: number,
): { pts: LocalPoint[]; map: (x: number, y: number) => [number, number] } => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of unit) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const sx = w / Math.max(maxX - minX, 1e-9);
  const sy = h / Math.max(maxY - minY, 1e-9);
  const map = (x: number, y: number): [number, number] => [
    (x - minX) * sx,
    (y - minY) * sy,
  ];
  return {
    pts: unit.map(([x, y]) => {
      const [mx, my] = map(x, y);
      // snap tiny float error so the outline never leaves the box
      return P(Math.min(w, Math.max(0, mx)), Math.min(h, Math.max(0, my)));
    }),
    map,
  };
};

const distToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// ---- kinds ----------------------------------------------------------------

const triangle = defineKind({
  id: "triangle",
  label: "Triangle",
  category: "basic",
  aliases: "triangle pyramid warning delta",
  generate: (w, h) => closed([P(w / 2, 0), P(w, h), P(0, h)]),
  // widest rect under the apex: half width, from 52% to 95% of the height
  textBox: (w, h) => ({
    x: w * 0.25,
    y: h * 0.52,
    width: w * 0.5,
    height: h * 0.43,
  }),
});

const hexagon = defineKind({
  id: "hexagon",
  label: "Hexagon",
  category: "flowchart",
  aliases: "hexagon preparation prepare hex six",
  generate: (w, h) =>
    closed([
      P(w * 0.25, 0),
      P(w * 0.75, 0),
      P(w, h / 2),
      P(w * 0.75, h),
      P(w * 0.25, h),
      P(0, h / 2),
    ]),
  textBox: (w, h) => ({
    x: w * 0.18,
    y: h * 0.15,
    width: w * 0.64,
    height: h * 0.7,
  }),
});

const parallelogram = defineKind({
  id: "parallelogram",
  label: "Parallelogram",
  category: "flowchart",
  aliases: "parallelogram input output io data skew",
  params: { skew: { default: 0.2, min: 0.02, max: 0.45 } },
  generate: (w, h, { skew }) =>
    closed([P(skew * w, 0), P(w, 0), P((1 - skew) * w, h), P(0, h)]),
  textBox: (w, h, { skew }) => ({
    x: skew * w + w * 0.02,
    y: h * 0.1,
    width: (1 - 2 * skew) * w - w * 0.04,
    height: h * 0.8,
  }),
});

const unitStar = (n: number, ratio: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 1 : ratio;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return pts;
};

const star = defineKind({
  id: "star",
  label: "Star",
  category: "stars",
  aliases: "star favorite rating bookmark burst",
  params: {
    points: { default: 5, min: 3, max: 24, integer: true },
    innerRatio: { default: 0.5, min: 0.1, max: 0.95 },
  },
  generate: (w, h, { points, innerRatio }) =>
    fitToBox(unitStar(points, innerRatio), w, h).pts,
  textBox: (w, h, { points, innerRatio }) => {
    const unit = unitStar(points, innerRatio);
    const { map } = fitToBox(unit, w, h);
    // inscribed circle radius (unit space) = distance from centre to outline
    let rho = Infinity;
    for (let i = 0; i < unit.length - 1; i++) {
      const [ax, ay] = unit[i];
      const [bx, by] = unit[i + 1];
      rho = Math.min(rho, distToSegment(0, 0, ax, ay, bx, by));
    }
    const [cx, cy] = map(0, 0);
    const [ox, oy] = map(1, 1);
    const [zx, zy] = map(0, 0);
    const half = (rho / Math.SQRT2) * 0.95;
    const hx = half * (ox - zx);
    const hy = half * (oy - zy);
    return { x: cx - hx, y: cy - hy, width: hx * 2, height: hy * 2 };
  },
});

/** Ellipse arc points from angle a0 to a1 (screen y down, sin up = -y) */
const ellipseArc = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  segments: number,
  skipFirst = true,
): LocalPoint[] => {
  const out: LocalPoint[] = [];
  for (let i = skipFirst ? 1 : 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    out.push(P(cx + rx * Math.cos(a), cy - ry * Math.sin(a)));
  }
  return out;
};

const cylinder = defineKind({
  id: "cylinder",
  label: "Cylinder",
  category: "flowchart",
  aliases: "cylinder database db storage disk data store",
  params: { capRatio: { default: 0.15, min: 0.05, max: 0.4 } },
  generate: (w, h, { capRatio }) => {
    const ry = (capRatio * h) / 2;
    const cx = w / 2;
    const rx = w / 2;
    const N = CYLINDER_ARC_SEGMENTS;
    const topY = ry;
    const botY = h - ry;
    // exact endpoints (cos(pi) etc. carry float error)
    const pts: LocalPoint[] = [P(0, topY)];
    // top-back arc: left -> top -> right
    pts.push(...ellipseArc(cx, topY, rx, ry, Math.PI, 0, N));
    // top-front arc: right -> bottom of cap -> left
    pts.push(...ellipseArc(cx, topY, rx, ry, 0, -Math.PI, N));
    // down the left side, bottom-front arc left -> right
    pts.push(P(0, botY));
    pts.push(...ellipseArc(cx, botY, rx, ry, Math.PI, 2 * Math.PI, N));
    // up the right side, then retrace the front arc right -> left
    pts.push(P(w, topY));
    pts.push(...ellipseArc(cx, topY, rx, ry, 0, -Math.PI, N));
    // pin the ends exactly
    pts[0] = P(0, topY);
    pts[pts.length - 1] = P(0, topY);
    return pts;
  },
  textBox: (w, h, { capRatio }) => ({
    x: w * 0.05,
    y: capRatio * h + h * 0.02,
    width: w * 0.9,
    height: Math.max(1, h * (1 - 1.5 * capRatio - 0.04)),
  }),
});

// Bump layout: angular share of each bump (clockwise from the top-left of the
// top). Bigger bumps on top, small ones along the flat bottom.
const CLOUD_BUMPS: { share: number; sag: number }[] = [
  { share: 1.2, sag: 0.34 },
  { share: 1.5, sag: 0.4 },
  { share: 1.2, sag: 0.36 },
  { share: 1.0, sag: 0.32 },
  { share: 0.9, sag: 0.18 },
  { share: 0.9, sag: 0.16 },
  { share: 0.9, sag: 0.18 },
  { share: 1.0, sag: 0.32 },
  { share: 1.3, sag: 0.38 },
];
const CLOUD_BOTTOM_SQUASH = 0.78;

const cloudPoints = (): [number, number][] => {
  const total = CLOUD_BUMPS.reduce((s, b) => s + b.share, 0);
  // joints on a base ellipse (unit radius), lower half flattened
  const start = -Math.PI * 0.62;
  const joints: [number, number][] = [];
  let acc = 0;
  for (const b of CLOUD_BUMPS) {
    const a = start + (acc / total) * Math.PI * 2;
    const s = Math.sin(a); // screen y = s (down positive)
    joints.push([1.35 * Math.cos(a), s > 0 ? s * CLOUD_BOTTOM_SQUASH : s]);
    acc += b.share;
  }
  const out: [number, number][] = [];
  const n = joints.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = joints[i];
    const [bx, by] = joints[(i + 1) % n];
    const dx = bx - ax;
    const dy = by - ay;
    const chord = Math.hypot(dx, dy);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    // outward normal (away from the origin)
    let nx = -dy / chord;
    let ny = dx / chord;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    const sag = CLOUD_BUMPS[i].sag * chord;
    const R = (chord * chord) / 4 / (2 * sag) + sag / 2;
    const ccx = mx - nx * (R - sag);
    const ccy = my - ny * (R - sag);
    const am = Math.atan2(ny, nx);
    const phi = Math.atan2(chord / 2, R - sag);
    // sweep from A to B through the apex
    const a0 = Math.atan2(ay - ccy, ax - ccx);
    let d = am - a0;
    while (d > Math.PI) {
      d -= 2 * Math.PI;
    }
    while (d < -Math.PI) {
      d += 2 * Math.PI;
    }
    const dir = d >= 0 ? 1 : -1;
    for (let k = 0; k < CLOUD_BUMP_SEGMENTS; k++) {
      const a = a0 + (dir * 2 * phi * k) / CLOUD_BUMP_SEGMENTS;
      out.push([ccx + R * Math.cos(a), ccy + R * Math.sin(a)]);
    }
  }
  out.push(out[0]);
  return out;
};

const cloud = defineKind({
  id: "cloud",
  label: "Cloud",
  category: "basic",
  aliases: "cloud network internet cloud service saas",
  generate: (w, h) => fitToBox(cloudPoints(), w, h).pts,
  textBox: (w, h) => ({
    x: w * 0.22,
    y: h * 0.3,
    width: w * 0.56,
    height: h * 0.4,
  }),
});

// ---- registry -------------------------------------------------------------

export const GEO_KINDS: readonly GeoKindDef[] = [
  triangle,
  hexagon,
  parallelogram,
  star,
  cylinder,
  cloud,
];

const GEO_KIND_MAP: ReadonlyMap<string, GeoKindDef> = new Map(
  GEO_KINDS.map((k) => [k.id, k]),
);

export const getGeoKind = (id: string): GeoKindDef | undefined =>
  GEO_KIND_MAP.get(id);

const mustKind = (kind: GeoShapeKind): GeoKindDef => {
  const def = GEO_KIND_MAP.get(kind);
  if (!def) {
    throw new Error(`Unknown geo shape kind: ${String(kind)}`);
  }
  return def;
};

// ---- element helpers --------------------------------------------------------

export const newGeoShapeMarker = (
  kind: GeoShapeKind,
  params?: unknown,
): GeoShapeMarker => {
  const def = mustKind(kind);
  // round-trip through generate-free sanitising: reuse defaults for unknowns
  const src = isPlainObject(params) ? params : {};
  const out: GeoShapeParams = { ...def.defaultParams };
  for (const key of Object.keys(def.defaultParams)) {
    const v = Object.prototype.hasOwnProperty.call(src, key)
      ? src[key]
      : undefined;
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = v;
    }
  }
  return { kind, v: 1, params: out };
};

/**
 * Generates the outline for a box at (x, y) and normalises it so points[0] is
 * [0, 0]. Returned x,y is the absolute position of the first point.
 */
export const generateGeoShapeLinePoints = (
  kind: GeoShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  params?: unknown,
): { x: number; y: number; points: LocalPoint[] } => {
  const raw = mustKind(kind).generate(w, h, params);
  const [ox, oy] = raw[0];
  return {
    x: x + ox,
    y: y + oy,
    points: raw.map(([px, py]) => P(px - ox, py - oy)),
  };
};

/** Reads the marker from untrusted customData; null when malformed. */
export const getGeoShapeMarker = (
  element: { customData?: unknown } | null | undefined,
): GeoShapeMarker | null => {
  const data = element?.customData;
  if (!isPlainObject(data)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(data, GEO_SHAPE_MARKER_KEY)) {
    return null;
  }
  const m = data[GEO_SHAPE_MARKER_KEY];
  if (!isPlainObject(m) || m.v !== 1 || typeof m.kind !== "string") {
    return null;
  }
  const def = GEO_KIND_MAP.get(m.kind);
  if (!def || !isPlainObject(m.params)) {
    return null;
  }
  const params: GeoShapeParams = {};
  for (const key of Object.keys(m.params)) {
    const v = m.params[key];
    if (
      FORBIDDEN_KEYS.has(key) ||
      typeof v !== "number" ||
      !Number.isFinite(v)
    ) {
      continue;
    }
    params[key] = v;
  }
  const marker: GeoShapeMarker = { kind: def.id, v: 1, params };
  if (m.detached === true) {
    marker.detached = true;
  }
  return marker;
};

export const isGeoShape = (
  element: ExcalidrawElement | null | undefined,
): boolean =>
  !!element &&
  element.type === "line" &&
  (element as ExcalidrawLineElement).polygon === true &&
  (() => {
    const m = getGeoShapeMarker(element);
    return !!m && !m.detached;
  })();

/** Integrity guard (D9): do the stored points still match the parameters? */
export const geoShapeMatchesPoints = (element: ExcalidrawElement): boolean => {
  if (element.type !== "line") {
    return false;
  }
  const marker = getGeoShapeMarker(element);
  if (!marker) {
    return false;
  }
  const pts = element.points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return false;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return false;
    }
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const { points } = generateGeoShapeLinePoints(
    marker.kind,
    0,
    0,
    w,
    h,
    marker.params,
  );
  if (points.length !== pts.length) {
    return false;
  }
  const tol = Math.max(0.5, 0.005 * Math.max(w, h));
  for (let i = 0; i < points.length; i++) {
    if (
      Math.abs(points[i][0] - pts[i][0]) > tol ||
      Math.abs(points[i][1] - pts[i][1]) > tol
    ) {
      return false;
    }
  }
  return true;
};

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** SVG path "M x y L ... Z" of the shape in a size x size box (D8). */
export const geoKindIconPath = (
  kind: GeoShapeKind,
  size = 20,
  params?: unknown,
): string => {
  const inset = Math.max(1, size * 0.08);
  const side = Math.max(1, size - inset * 2);
  const pts = mustKind(kind).generate(side, side, params);
  // last point repeats the first; Z closes the path
  const body = pts
    .slice(0, -1)
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"} ${fmt(x + inset)} ${fmt(y + inset)}`,
    )
    .join(" ");
  return `${body} Z`;
};
