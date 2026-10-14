import { strokeGrid } from "./staticScene";

type Stroke = {
  from: [number, number];
  to: [number, number];
  dash: number[];
  offset: number;
};

const recordStrokes = (scrollX: number, scrollY: number) => {
  const strokes: Stroke[] = [];
  let from: [number, number] = [0, 0];
  let to: [number, number] = [0, 0];
  const context: any = {
    lineDashOffset: 0,
    dash: [] as number[],
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    setLineDash(dash: number[]) {
      this.dash = dash;
    },
    moveTo: (x: number, y: number) => {
      from = [x, y];
    },
    lineTo: (x: number, y: number) => {
      to = [x, y];
    },
    stroke() {
      strokes.push({ from, to, dash: this.dash, offset: this.lineDashOffset });
    },
  };
  strokeGrid(
    context,
    20,
    1,
    scrollX,
    scrollY,
    { value: 1 as any },
    "light",
    300,
    300,
    1,
  );
  return strokes;
};

/**
 * Scene coordinates (mod the dash period) at which dashes begin along a line:
 * the line's start on the canvas is `start`, the canvas is scrolled by
 * `scroll`, and the dash pattern begins `offset` units into the pattern.
 */
const dashStartInScene = (
  start: number,
  scroll: number,
  dash: number[],
  offset: number,
) => {
  const period = dash[0] + dash[1];
  const phase = (((start - scroll - offset) % period) + period) % period;
  return Math.round(phase * 1e6) / 1e6;
};

describe("strokeGrid dotted lines", () => {
  // differ by a non-multiple of the dash period (6 at zoom 1) and cross a grid
  // cell (20), which is when the line start jumps in the scene
  const scrolls = [
    [0, 0],
    [27.3, 24.1],
  ] as const;

  it("anchors the dash phase of horizontal lines to the scene", () => {
    const phases = scrolls.map(([sx, sy]) =>
      recordStrokes(sx, sy)
        .filter((s) => s.from[1] === s.to[1] && s.dash.length)
        .map((s) => dashStartInScene(s.from[0], sx, s.dash, s.offset)),
    );
    expect(phases[0].length).toBeGreaterThan(0);
    new Set([...phases[0], ...phases[1]]).forEach((p) =>
      expect(p).toBe(phases[0][0]),
    );
  });

  it("anchors the dash phase of vertical lines to the scene", () => {
    const phases = scrolls.map(([sx, sy]) =>
      recordStrokes(sx, sy)
        .filter((s) => s.from[0] === s.to[0] && s.dash.length)
        .map((s) => dashStartInScene(s.from[1], sy, s.dash, s.offset)),
    );
    expect(phases[0].length).toBeGreaterThan(0);
    new Set([...phases[0], ...phases[1]]).forEach((p) =>
      expect(p).toBe(phases[0][0]),
    );
  });
});
