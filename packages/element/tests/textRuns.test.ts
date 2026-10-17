import rough from "roughjs/bin/rough";

import { arrayToMap, THEME } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { clearElementCanvasCache, renderElement } from "../src/renderElement";
import {
  fillTextLineWithRuns,
  getTextRuns,
  invalidateTextRunStyles,
  setTextRunStyler,
} from "../src/textRuns";

import type { TextRun, TextRunStyler } from "../src/textRuns";

/** A context that records fillText / stroke calls; 10 px per character. */
const recordingContext = () => {
  const calls: { text: string; x: number; fill: string }[] = [];
  const strokes: { dash: number[]; color: string }[] = [];
  let dash: number[] = [];
  const ctx: any = {
    textAlign: "left",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (text: string, x: number) =>
      calls.push({ text, x, fill: ctx.fillStyle }),
    save: () => {},
    restore: () => {},
    setLineDash: (d: number[]) => {
      dash = d;
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => strokes.push({ dash, color: ctx.strokeStyle }),
  };
  return { ctx: ctx as CanvasRenderingContext2D, calls, strokes };
};

describe("fillTextLineWithRuns", () => {
  const runs: TextRun[] = [
    { start: 3, end: 5, color: "dim" },
    { start: 5, end: 8, color: "link", underline: "solid" },
    { start: 8, end: 10, color: "dim" },
  ];

  it("splits a line into plain and styled segments at prefix widths", () => {
    const { ctx, calls, strokes } = recordingContext();
    fillTextLineWithRuns(ctx, "go [[Map]] now", 0, 0, 20, 20, runs);
    expect(calls).toEqual([
      { text: "go ", x: 0, fill: "#000" },
      { text: "[[", x: 30, fill: "dim" },
      { text: "Map", x: 50, fill: "link" },
      { text: "]]", x: 80, fill: "dim" },
      { text: " now", x: 100, fill: "#000" },
    ]);
    expect(strokes).toEqual([{ dash: [], color: "link" }]);
    expect(ctx.fillStyle).toBe("#000");
    expect(ctx.textAlign).toBe("left");
  });

  it("honours centre alignment and the line's offset in the text", () => {
    const { ctx, calls } = recordingContext();
    ctx.textAlign = "center";
    // line "ab [[x]]" starts at offset 10 of the element text
    fillTextLineWithRuns(ctx, "ab [[x]]", 10, 100, 0, 20, [
      { start: 13, end: 18, color: "link", underline: "dashed" },
    ]);
    expect(calls.map((c) => [c.text, c.x])).toEqual([
      ["ab ", 60],
      ["[[x]]", 90],
    ]);
    expect(ctx.textAlign).toBe("center");
  });

  it("draws the line once when no run touches it", () => {
    const { ctx, calls } = recordingContext();
    fillTextLineWithRuns(ctx, "plain", 20, 5, 0, 20, runs);
    expect(calls).toEqual([{ text: "plain", x: 5, fill: "#000" }]);
  });
});

describe("text run styler and the element bitmap cache", () => {
  const rc = rough.canvas(document.createElement("canvas"));
  const ctx = document.createElement("canvas").getContext("2d")!;
  const appState: any = {
    zoom: { value: 1 },
    scrollX: 0,
    scrollY: 0,
    theme: THEME.LIGHT,
    shouldCacheIgnoreZoom: false,
    frameRendering: { enabled: true, clip: true, name: true, outline: true },
    selectedElementIds: {},
  };
  const config = (isExporting = false): any => ({
    canvasBackgroundColor: "#fff",
    imageCache: new Map(),
    renderGrid: false,
    isExporting,
    embedsValidationStatus: new Map(),
    elementsPendingErasure: new Set(),
    pendingFlowchartNodes: null,
    theme: THEME.LIGHT,
  });
  const draw = (el: any, isExporting = false) => {
    const map = arrayToMap([el]) as any;
    renderElement(el, map, map, rc, ctx, config(isExporting), appState);
  };

  afterEach(() => {
    setTextRunStyler(null);
    clearElementCanvasCache();
  });

  it("styles once per raster, re-styles only styled text on invalidate", () => {
    const styler = vi.fn<TextRunStyler>((el) =>
      el.text.includes("[[") ? [{ start: 0, end: 7, color: "#00f" }] : null,
    );
    setTextRunStyler(styler);
    const linked = API.createElement({ type: "text", text: "[[Map]]" });
    const plain = API.createElement({ type: "text", text: "plain" });
    draw(linked);
    draw(plain);
    draw(linked);
    draw(plain);
    expect(styler).toHaveBeenCalledTimes(2);

    invalidateTextRunStyles();
    draw(linked);
    draw(plain);
    expect(styler).toHaveBeenCalledTimes(3);
    expect(styler.mock.calls[2][0]).toBe(linked);

    // install / remove re-rasterises every text once
    setTextRunStyler(styler);
    draw(linked);
    draw(plain);
    expect(styler).toHaveBeenCalledTimes(5);
  });

  it("never styles exports", () => {
    const styler = vi.fn<TextRunStyler>(() => [{ start: 0, end: 2 }]);
    setTextRunStyler(styler);
    draw(API.createElement({ type: "text", text: "[[a]]" }), true);
    expect(styler).not.toHaveBeenCalled();
  });

  it("returns null without a styler, for empty runs and for \\r text", () => {
    const el = API.createElement({ type: "text", text: "[[a]]" }) as any;
    expect(getTextRuns(el, false)).toBeNull();
    setTextRunStyler(() => []);
    expect(getTextRuns(el, false)).toBeNull();
    setTextRunStyler(() => [{ start: 0, end: 1 }]);
    expect(getTextRuns(el, false)).toHaveLength(1);
    expect(getTextRuns({ ...el, text: "[[a]]\r\nb" }, false)).toBeNull();
  });
});
