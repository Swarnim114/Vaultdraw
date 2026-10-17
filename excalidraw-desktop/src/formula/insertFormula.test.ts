import { describe, expect, it, vi } from "vitest";

import { insertFormula, replaceFormula } from "./insertFormula";

import type { RenderedFormula } from "./insertFormula";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>';
const R: RenderedFormula = {
  svg: SVG,
  width: 40,
  height: 20,
  source: "x^2",
  display: true,
  color: "#1e1e1e",
};

const makeApi = (scene: any[] = []) => {
  const calls: string[] = [];
  const api: any = {
    addFiles: vi.fn(() => calls.push("addFiles")),
    updateScene: vi.fn(() => calls.push("updateScene")),
    getSceneElementsIncludingDeleted: () => scene,
    getAppState: () => ({
      scrollX: -100,
      scrollY: -50,
      width: 800,
      height: 600,
      zoom: { value: 2 },
      currentItemOpacity: 100,
    }),
  };
  return { api, calls };
};

describe("insertFormula", () => {
  it("adds the file first, then a single updateScene at the view centre", async () => {
    const { api, calls } = makeApi();
    const id = await insertFormula(api, R);
    expect(calls).toEqual(["addFiles", "updateScene"]);
    const file = api.addFiles.mock.calls[0][0][0];
    expect(file.mimeType).toBe("image/svg+xml");
    expect(file.dataURL).toMatch(/^data:image\/svg\+xml;base64,/);
    const arg = api.updateScene.mock.calls[0][0];
    expect(arg.captureUpdate).toBe("IMMEDIATELY");
    const el = arg.elements[0];
    expect(el.id).toBe(id);
    expect(el.fileId).toBe(file.id);
    expect(el.status).toBe("saved");
    expect(el.customData.latex).toMatchObject({
      v: 1,
      source: "x^2",
      width: 40,
    });
    // centre = (100 + 800/2/2, 50 + 600/2/2) = (300, 200)
    expect(el.x + el.width / 2).toBe(300);
    expect(el.y + el.height / 2).toBe(200);
    expect(arg.appState.selectedElementIds).toEqual({ [id]: true });
  });
});

describe("replaceFormula", () => {
  it("keeps centre, scale and angle, resets crop, one update", async () => {
    const { api: a0 } = makeApi();
    await insertFormula(a0, R);
    const base = a0.updateScene.mock.calls[0][0].elements[0];
    const el = {
      ...base,
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      angle: 0.5,
      crop: {
        x: 1,
        y: 1,
        width: 5,
        height: 5,
        naturalWidth: 40,
        naturalHeight: 20,
      },
    };
    const { api, calls } = makeApi([el]);
    const next = {
      ...R,
      source: "y",
      svg: SVG.replace("40", "60"),
      width: 60,
      height: 20,
    };
    await replaceFormula(api, el, el.customData.latex, next);
    expect(calls).toEqual(["addFiles", "updateScene"]);
    const out = api.updateScene.mock.calls[0][0].elements[0];
    expect(out.width).toBe(120); // scale 2
    expect(out.height).toBe(40);
    expect(out.x + out.width / 2).toBe(140);
    expect(out.y + out.height / 2).toBe(120);
    expect(out.angle).toBe(0.5);
    expect(out.crop).toBeNull();
    expect(out.customData.latex.source).toBe("y");
    expect(out.fileId).not.toBe(el.fileId);
  });
});
