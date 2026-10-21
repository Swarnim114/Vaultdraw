import rough from "roughjs/bin/rough";
import { describe, expect, it, vi } from "vitest";

import { arrayToMap } from "@excalidraw/common";
import { newElement } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";

import {
  renderStaticScene,
  renderStaticSceneInSlices,
  strokeGrid,
} from "./staticScene";

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

describe("renderStaticSceneInSlices", () => {
  const paintConfig = () => {
    const elements = [0, 1, 2, 3].map((i) =>
      newElement({
        type: "rectangle",
        x: i * 30,
        y: i * 20,
        width: 25,
        height: 25,
        backgroundColor: i % 2 ? "#ffc9c9" : "transparent",
        seed: 7 + i,
      }),
    ) as NonDeletedExcalidrawElement[];
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 150;
    const elementsMap = arrayToMap(elements) as any;
    return {
      canvas,
      config: {
        canvas,
        rc: rough.canvas(canvas),
        elementsMap,
        allElementsMap: elementsMap,
        visibleElements: elements,
        scale: 1,
        appState: {
          ...getDefaultAppState(),
          frameRendering: {
            enabled: true,
            clip: true,
            name: true,
            outline: true,
          },
          viewBackgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0,
          theme: "light",
        },
        renderConfig: {
          canvasBackgroundColor: "#ffffff",
          imageCache: new Map(),
          renderGrid: false,
          isExporting: true,
          embedsValidationStatus: new Map(),
          elementsPendingErasure: new Set(),
          pendingFlowchartNodes: null,
          theme: "light",
        },
      } as any,
    };
  };

  it("makes the same canvas calls as the one-task render and yields between elements", async () => {
    const one = paintConfig();
    renderStaticScene(one.config);
    const reference = (one.canvas.getContext("2d") as any).__getEvents();

    const sliced = paintConfig();
    const yieldFn = vi.fn(async () => {});
    await renderStaticSceneInSlices(sliced.config, { budgetMs: 0, yieldFn });

    expect((sliced.canvas.getContext("2d") as any).__getEvents()).toEqual(
      reference,
    );
    expect(reference.length).toBeGreaterThan(10);
    expect(yieldFn).toHaveBeenCalledTimes(4); // once per element
  });

  it("does not yield within the budget", async () => {
    const yieldFn = vi.fn(async () => {});
    await renderStaticSceneInSlices(paintConfig().config, {
      budgetMs: 60_000,
      yieldFn,
    });
    expect(yieldFn).not.toHaveBeenCalled();
  });
});
