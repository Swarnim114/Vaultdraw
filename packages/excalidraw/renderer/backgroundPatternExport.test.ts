import { getDefaultAppState } from "../appState";
import { createBackgroundPattern } from "../data/backgroundPattern";
import { exportToSvg } from "../scene/export";
import { API } from "../tests/helpers/api";

import * as patternRenderer from "./backgroundPattern";
import { renderStaticScene } from "./staticScene";

import type { StaticSceneRenderConfig } from "../scene/types";

const elements = [
  API.createElement({ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }),
];

const svgFor = async (over: Record<string, unknown>) =>
  (
    await exportToSvg(
      elements,
      {
        exportBackground: true,
        viewBackgroundColor: "#ffffff",
        viewBackgroundPattern: createBackgroundPattern("grid"),
        ...over,
      },
      null,
      { skipInliningFonts: true },
    )
  ).outerHTML;

describe("SVG export of background patterns", () => {
  it("includes a pattern when the background is exported", async () => {
    const svg = await svgFor({});
    expect(svg).toContain("<pattern");
    expect(svg).toContain('fill="url(#bg-pattern-');
  });

  it("omits it when disabled, without background, or plain", async () => {
    expect(await svgFor({ exportBackgroundPattern: false })).not.toContain(
      "<pattern",
    );
    expect(await svgFor({ exportBackground: false })).not.toContain("<pattern");
    expect(await svgFor({ viewBackgroundPattern: null })).not.toContain(
      "<pattern",
    );
  });

  it("draws the margin line for ruled paper and dots as circles", async () => {
    const lines = await svgFor({
      viewBackgroundPattern: createBackgroundPattern("lines"),
    });
    expect(lines).toContain("<pattern");
    expect(lines).toContain("<path");
    const dots = await svgFor({
      viewBackgroundPattern: createBackgroundPattern("isometric"),
    });
    expect(dots.match(/<circle/g)).toHaveLength(3);
  });
});

describe("static scene", () => {
  const render = (
    renderGrid: boolean,
    isExporting = false,
    bg: any = "#fff",
  ) => {
    const spy = vi
      .spyOn(patternRenderer, "renderBackgroundPattern")
      .mockImplementation(() => {});
    const canvas = document.createElement("canvas");
    renderStaticScene(
      {
        canvas,
        rc: {} as any,
        elementsMap: new Map() as any,
        allElementsMap: new Map() as any,
        visibleElements: [],
        scale: 1,
        appState: {
          ...getDefaultAppState(),
          viewBackgroundColor: bg,
          viewBackgroundPattern: createBackgroundPattern("grid"),
        } as any,
        renderConfig: {
          renderGrid,
          isExporting,
          theme: "light",
          canvasBackgroundColor: "#fff",
          imageCache: new Map(),
          embedsValidationStatus: new Map(),
          elementsPendingErasure: new Set(),
          pendingFlowchartNodes: null,
        } as any,
      } as StaticSceneRenderConfig,
      false,
    );
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    return calls;
  };

  it("draws the pattern when the snap grid is off", () => {
    expect(render(false)).toBe(1);
  });

  it("skips the pattern while the snap grid is shown", () => {
    expect(render(true)).toBe(0);
  });

  it("exports need a background", () => {
    expect(render(false, true)).toBe(1);
    expect(render(false, true, null)).toBe(0);
  });
});
