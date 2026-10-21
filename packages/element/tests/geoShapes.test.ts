import {
  CYLINDER_ARC_SEGMENTS,
  GEO_KINDS,
  GEO_SHAPE_MARKER_KEY,
  geoKindIconPath,
  geoShapeMatchesPoints,
  generateGeoShapeLinePoints,
  getGeoKind,
  getGeoShapeMarker,
  isGeoShape,
  newGeoShapeMarker,
} from "../src/geoShapes";

import type { ExcalidrawElement } from "../src/types";

const EPS = 1e-6;
const W = 200;
const H = 120;

const pointInPolygon = (x: number, y: number, poly: readonly number[][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = Boolean(yi > y) !== Boolean(yj > y);
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const makeElement = (
  kind: Parameters<typeof newGeoShapeMarker>[0],
  w = W,
  h = H,
  params?: Record<string, number>,
) => {
  const marker = newGeoShapeMarker(kind, params);
  const { x, y, points } = generateGeoShapeLinePoints(
    kind,
    10,
    20,
    w,
    h,
    marker.params,
  );
  return {
    type: "line",
    polygon: true,
    x,
    y,
    points,
    roundness: null,
    customData: { [GEO_SHAPE_MARKER_KEY]: marker },
  } as unknown as ExcalidrawElement;
};

describe("geo shape registry", () => {
  it("has the six kinds with an O(1) lookup", () => {
    expect(GEO_KINDS.map((k) => k.id)).toEqual([
      "triangle",
      "hexagon",
      "parallelogram",
      "star",
      "cylinder",
      "cloud",
    ]);
    for (const k of GEO_KINDS) {
      expect(getGeoKind(k.id)).toBe(k);
      expect(k.label.length).toBeGreaterThan(0);
      expect(k.aliases.length).toBeGreaterThan(0);
    }
    expect(getGeoKind("nope")).toBeUndefined();
    expect(getGeoKind("__proto__")).toBeUndefined();
    expect(getGeoKind("cylinder")!.aliases).toContain("database");
  });

  describe.each(GEO_KINDS.map((k) => [k.id, k] as const))("%s", (_id, def) => {
    it("is closed", () => {
      const pts = def.generate(W, H);
      expect(pts.length).toBeGreaterThan(3);
      expect(pts[pts.length - 1][0]).toBeCloseTo(pts[0][0], 9);
      expect(pts[pts.length - 1][1]).toBeCloseTo(pts[0][1], 9);
    });

    it("fills the box and stays inside it", () => {
      for (const [w, h] of [
        [W, H],
        [40, 300],
        [300, 40],
      ]) {
        const pts = def.generate(w, h);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(-EPS);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(-EPS);
        expect(Math.max(...xs)).toBeLessThanOrEqual(w + EPS);
        expect(Math.max(...ys)).toBeLessThanOrEqual(h + EPS);
        expect(Math.min(...xs)).toBeLessThan(EPS);
        expect(Math.min(...ys)).toBeLessThan(EPS);
        expect(Math.max(...xs)).toBeGreaterThan(w - EPS);
        expect(Math.max(...ys)).toBeGreaterThan(h - EPS);
      }
    });

    it("never produces NaN for degenerate boxes", () => {
      for (const [w, h] of [
        [0, 0],
        [0, 50],
        [50, 0],
        [-10, -10],
        [1e-9, 1e-9],
        [NaN, 10],
        [10, Infinity],
      ]) {
        for (const p of def.generate(w, h)) {
          expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
          expect(p[0]).toBeGreaterThanOrEqual(-EPS);
          expect(p[1]).toBeGreaterThanOrEqual(-EPS);
        }
        const t = def.textBox(w, h);
        expect(Object.values(t).every(Number.isFinite)).toBe(true);
      }
    });

    it("textBox is inside the box and inside the outline", () => {
      for (const [w, h] of [
        [W, H],
        [100, 100],
        [60, 240],
        [240, 60],
      ]) {
        const poly = def.generate(w, h);
        const t = def.textBox(w, h);
        expect(t.width).toBeGreaterThan(0);
        expect(t.height).toBeGreaterThan(0);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(w + EPS);
        expect(t.y + t.height).toBeLessThanOrEqual(h + EPS);
        for (const [cx, cy] of [
          [t.x, t.y],
          [t.x + t.width, t.y],
          [t.x, t.y + t.height],
          [t.x + t.width, t.y + t.height],
          [t.x + t.width / 2, t.y + t.height / 2],
        ]) {
          expect(pointInPolygon(cx, cy, poly)).toBe(true);
        }
      }
    });

    it("is deterministic", () => {
      expect(def.generate(W, H)).toEqual(def.generate(W, H));
    });

    it("falls back to defaults for invalid params", () => {
      const base = def.generate(W, H);
      for (const bad of [
        undefined,
        null,
        "x",
        [],
        { nope: 3 },
        Object.fromEntries(Object.keys(def.defaultParams).map((k) => [k, NaN])),
      ]) {
        expect(def.generate(W, H, bad)).toEqual(base);
      }
      expect(def.generate(W, H, def.defaultParams)).toEqual(base);
    });

    it("produces a well-formed icon path", () => {
      const path = geoKindIconPath(def.id, 20);
      expect(path).toMatch(/^M -?[\d.]+ -?[\d.]+( L -?[\d.]+ -?[\d.]+)+ Z$/);
      expect(path).not.toContain("NaN");
      const nums = path.match(/-?[\d.]+/g)!.map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...nums)).toBeLessThanOrEqual(19);
    });

    it("normalises line points", () => {
      const raw = def.generate(W, H);
      const { x, y, points } = generateGeoShapeLinePoints(
        def.id,
        100,
        -50,
        W,
        H,
      );
      expect(points[0]).toEqual([0, 0]);
      expect(points).toHaveLength(raw.length);
      points.forEach((p, i) => {
        expect(x + p[0]).toBeCloseTo(100 + raw[i][0], 9);
        expect(y + p[1]).toBeCloseTo(-50 + raw[i][1], 9);
      });
      expect(points[points.length - 1][0]).toBeCloseTo(0, 9);
      expect(points[points.length - 1][1]).toBeCloseTo(0, 9);
    });

    it("matches its points when fresh and after a JSON round trip", () => {
      const el = makeElement(def.id);
      expect(isGeoShape(el)).toBe(true);
      expect(geoShapeMatchesPoints(el)).toBe(true);
      expect(geoShapeMatchesPoints(JSON.parse(JSON.stringify(el)))).toBe(true);
    });

    it("detects a moved point", () => {
      const el = makeElement(def.id) as any;
      const i = Math.floor(el.points.length / 3);
      el.points = el.points.map((p: number[], k: number) =>
        k === i ? [p[0] + 6, p[1] + 6] : p,
      );
      expect(geoShapeMatchesPoints(el)).toBe(false);
    });
  });

  it("scaled shapes still match (resize regenerates from bounds)", () => {
    for (const k of GEO_KINDS) {
      expect(geoShapeMatchesPoints(makeElement(k.id, 37, 411))).toBe(true);
    }
  });

  describe("params", () => {
    it("star: clamps and counts points", () => {
      const star = getGeoKind("star")!;
      expect(star.defaultParams).toEqual({ points: 5, innerRatio: 0.5 });
      expect(star.generate(W, H)).toHaveLength(11);
      expect(star.generate(W, H, { points: 7 })).toHaveLength(15);
      expect(star.generate(W, H, { points: 1 })).toHaveLength(7);
      expect(star.generate(W, H, { points: 999 })).toHaveLength(49);
      expect(star.generate(W, H, { points: 5.6 })).toHaveLength(13);
      expect(star.generate(W, H, { innerRatio: 5 })).toEqual(
        star.generate(W, H, { innerRatio: 0.95 }),
      );
      expect(star.generate(W, H, { innerRatio: -1 })).toEqual(
        star.generate(W, H, { innerRatio: 0.1 }),
      );
      expect(star.generate(W, H, { innerRatio: Infinity })).toEqual(
        star.generate(W, H),
      );
    });

    it("parallelogram skew moves the top-left corner", () => {
      const p = getGeoKind("parallelogram")!;
      expect(p.generate(100, 50)[0][0]).toBeCloseTo(20);
      expect(p.generate(100, 50, { skew: 0.3 })[0][0]).toBeCloseTo(30);
      expect(p.generate(100, 50, { skew: 9 })[0][0]).toBeCloseTo(45);
    });

    it("cylinder capRatio sets the ellipse height", () => {
      const c = getGeoKind("cylinder")!;
      const side = (ratio?: number) =>
        c.generate(100, 100, ratio ? { capRatio: ratio } : undefined)[0][1];
      expect(side()).toBeCloseTo(7.5);
      expect(side(0.3)).toBeCloseTo(15);
      expect(side(5)).toBeCloseTo(20);
    });
  });

  describe("point counts", () => {
    it("are fixed and modest", () => {
      const count = (id: string) => getGeoKind(id)!.generate(W, H).length;
      expect(count("triangle")).toBe(4);
      expect(count("hexagon")).toBe(7);
      expect(count("parallelogram")).toBe(5);
      expect(count("star")).toBe(11);
      expect(count("cylinder")).toBe(4 * CYLINDER_ARC_SEGMENTS + 3);
      expect(count("cloud")).toBeGreaterThanOrEqual(40);
      expect(count("cloud")).toBeLessThanOrEqual(64);
    });
  });

  it("cylinder retraces the front arc of the top ellipse", () => {
    const N = CYLINDER_ARC_SEGMENTS;
    const pts = getGeoKind("cylinder")!.generate(W, H);
    const frontFirst = pts.slice(N, 2 * N + 1); // right -> left
    const frontAgain = pts.slice(pts.length - N - 1); // right -> left
    expect(frontFirst).toHaveLength(N + 1);
    expect(frontAgain).toHaveLength(N + 1);
    frontAgain.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(frontFirst[i][0], 6);
      expect(p[1]).toBeCloseTo(frontFirst[i][1], 6);
    });
    // the front arc dips below the ellipse centre line
    const cy = pts[0][1];
    expect(Math.max(...frontFirst.map((p) => p[1]))).toBeGreaterThan(cy + 1);
    // the back arc rises to the top edge
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(0, 6);
  });

  describe("getGeoShapeMarker", () => {
    const valid = { kind: "star", v: 1, params: { points: 6 } };
    const get = (customData: unknown) =>
      getGeoShapeMarker({ customData } as any);

    it("accepts a valid marker", () => {
      expect(get({ [GEO_SHAPE_MARKER_KEY]: valid })).toEqual(valid);
      expect(
        get({ [GEO_SHAPE_MARKER_KEY]: { ...valid, detached: true } })?.detached,
      ).toBe(true);
    });

    it("rejects malformed customData", () => {
      const k = GEO_SHAPE_MARKER_KEY;
      const bad: unknown[] = [
        undefined,
        null,
        "x",
        42,
        [],
        {},
        { [k]: null },
        { [k]: "star" },
        { [k]: { ...valid, kind: "blob" } },
        { [k]: { ...valid, kind: "__proto__" } },
        { [k]: { ...valid, kind: "toString" } },
        { [k]: { ...valid, kind: 3 } },
        { [k]: { kind: "star", params: {} } },
        { [k]: { ...valid, v: 2 } },
        { [k]: { ...valid, v: "1" } },
        { [k]: { ...valid, params: null } },
        { [k]: { ...valid, params: 5 } },
        { [k]: { ...valid, params: [1] } },
        JSON.parse(`{"__proto__": {"${k}": ${JSON.stringify(valid)}}}`),
      ];
      for (const b of bad) {
        expect(get(b)).toBeNull();
      }
      expect(getGeoShapeMarker(null)).toBeNull();
    });

    it("drops non-numeric and prototype-pollution-ish params", () => {
      const params = JSON.parse(
        '{"points": 6, "__proto__": {"polluted": 1}, "constructor": 2, "prototype": 3, "x": "7", "y": null}',
      );
      const m = get({ [GEO_SHAPE_MARKER_KEY]: { ...valid, params } })!;
      expect(m.params).toEqual({ points: 6 });
      expect(Object.keys(m.params)).toEqual(["points"]);
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  it("isGeoShape requires a closed line with a live marker", () => {
    const el = makeElement("star") as any;
    expect(isGeoShape(el)).toBe(true);
    expect(isGeoShape({ ...el, polygon: false })).toBe(false);
    expect(isGeoShape({ ...el, type: "freedraw" })).toBe(false);
    expect(isGeoShape({ ...el, customData: undefined })).toBe(false);
    expect(
      isGeoShape({
        ...el,
        customData: {
          [GEO_SHAPE_MARKER_KEY]: {
            ...el.customData[GEO_SHAPE_MARKER_KEY],
            detached: true,
          },
        },
      }),
    ).toBe(false);
  });

  it("perf: generate stays cheap", () => {
    const N = 10000;
    for (const k of GEO_KINDS) {
      k.generate(200, 120); // warm up
    }
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      for (const k of GEO_KINDS) {
        k.generate(200, 120);
      }
    }
    const per = (performance.now() - t0) / (N * GEO_KINDS.length);
    console.info(
      `geoShapes generate: ${per.toFixed(5)} ms/shape (avg over ${
        GEO_KINDS.length
      } kinds, ${N} rounds)`,
    );
    expect(per).toBeLessThan(0.5);
  });
});
