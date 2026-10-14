import React from "react";

import { Excalidraw } from "../index";
import { updatePageSetup } from "../data/pageSetup";
import {
  canStartGestureAt,
  clampGesturePointer,
  constrainDragOffset,
} from "../pageConstraints";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

import type { PageSetup } from "../data/pageSetup";

unmountComponent();

const { h } = window;

// 400 x 300 pages; separate: page 1 starts at y = 340 (40 gap)
const setup = (changes: Partial<PageSetup> = {}) =>
  updatePageSetup(null, {
    size: "custom",
    width: 400,
    height: 300,
    pageCount: 3,
    layout: "separate",
    ...changes,
  });

const renderWith = async (pageSetup: PageSetup | null) => {
  await render(<Excalidraw initialData={{ appState: { pageSetup } }} />);
  expect(h.state.scrollX).toBe(0);
  expect(h.state.scrollY).toBe(0);
};

const mouse = new Pointer("mouse");

const drag = (from: [number, number], to: [number, number]) => {
  mouse.reset();
  mouse.downAt(...from);
  mouse.moveTo(...to);
  mouse.upAt(...to);
};

describe("pageConstraints (pure)", () => {
  const sep = setup();
  const cont = setup({ layout: "continuous" });

  it("is a no-op without page mode", () => {
    const off = { ...sep, enabled: false };
    for (const s of [null, undefined, off]) {
      const p = { x: -50, y: 9999 };
      expect(canStartGestureAt(s, -5, -5)).toBe(true);
      expect(clampGesturePointer(s, { x: 0, y: 0 }, p)).toBe(p);
      const o = { x: 5, y: 5 };
      expect(constrainDragOffset(s, [0, 0, 10, 10], o)).toBe(o);
    }
  });

  it("only allows starting on a page", () => {
    expect(canStartGestureAt(sep, 10, 10)).toBe(true);
    expect(canStartGestureAt(sep, 10, 350)).toBe(true);
    expect(canStartGestureAt(sep, -1, 10)).toBe(false);
    expect(canStartGestureAt(sep, 401, 10)).toBe(false);
    expect(canStartGestureAt(sep, 10, 320)).toBe(false); // gap
    expect(canStartGestureAt(sep, 10, 5000)).toBe(false);
    expect(canStartGestureAt(cont, 10, 320)).toBe(true);
  });

  it("clamps the pointer to the starting page (separate)", () => {
    expect(
      clampGesturePointer(sep, { x: 10, y: 10 }, { x: 500, y: 320 }),
    ).toEqual({ x: 400, y: 300 });
    expect(
      clampGesturePointer(sep, { x: 10, y: 350 }, { x: -9, y: 100 }),
    ).toEqual({ x: 0, y: 340 });
    const inside = { x: 5, y: 5 };
    expect(clampGesturePointer(sep, { x: 1, y: 1 }, inside)).toBe(inside);
  });

  it("clamps the pointer to the whole column (continuous)", () => {
    expect(
      clampGesturePointer(cont, { x: 10, y: 10 }, { x: 500, y: 450 }),
    ).toEqual({ x: 400, y: 450 });
    expect(
      clampGesturePointer(cont, { x: 10, y: 10 }, { x: 5, y: 99999 }),
    ).toEqual({ x: 5, y: 900 });
  });

  it("keeps dragged bounds inside one page", () => {
    // moved past the right edge
    expect(
      constrainDragOffset(sep, [10, 10, 60, 60], { x: 400, y: 0 }),
    ).toEqual({ x: 340, y: 0 });
    // centre crosses into page 1: lands fully on it
    expect(
      constrainDragOffset(sep, [10, 200, 60, 260], { x: 0, y: 100 }),
    ).toEqual({ x: 0, y: 140 });
    // inside: same object
    const o = { x: 1, y: 1 };
    expect(constrainDragOffset(sep, [10, 10, 60, 60], o)).toBe(o);
    // bigger than a page: top-left aligned
    expect(
      constrainDragOffset(sep, [50, 50, 600, 400], { x: 0, y: 0 }),
    ).toEqual({ x: -50, y: -50 });
  });

  it("lets content cross page breaks in the continuous layout", () => {
    const o = { x: 0, y: 200 };
    expect(constrainDragOffset(cont, [10, 200, 60, 260], o)).toBe(o);
    expect(
      constrainDragOffset(cont, [10, 700, 60, 860], { x: 0, y: 100 }),
    ).toEqual({ x: 0, y: 40 });
  });
});

describe("page mode: pointer gestures", () => {
  it("refuses to start creating outside a page", async () => {
    await renderWith(setup());
    UI.clickTool("rectangle");
    drag([450, 50], [500, 100]);
    expect(h.elements.length).toBe(0);
    // gap between pages
    drag([50, 320], [100, 330]);
    expect(h.elements.length).toBe(0);
    // freedraw and text too
    UI.clickTool("freedraw");
    drag([450, 50], [470, 100]);
    expect(h.elements.length).toBe(0);
    UI.clickTool("text");
    mouse.reset();
    mouse.clickAt(450, 50);
    expect(h.state.editingTextElement).toBeNull();
    expect(h.elements.length).toBe(0);
  });

  it("clamps a rectangle drawn from inside to outside", async () => {
    await renderWith(setup());
    UI.clickTool("rectangle");
    drag([300, 250], [900, 900]);
    expect(h.elements.length).toBe(1);
    const r = h.elements[0];
    expect([r.x, r.y, r.x + r.width, r.y + r.height]).toEqual([
      300, 250, 400, 300,
    ]);
  });

  it("clamps freedraw points onto the page edge", async () => {
    await renderWith(setup());
    UI.clickTool("freedraw");
    mouse.reset();
    mouse.downAt(350, 100);
    mouse.moveTo(380, 120);
    mouse.moveTo(700, 150);
    mouse.moveTo(390, 500);
    mouse.upAt(390, 500);
    const el = h.elements[0] as any;
    for (const [px, py] of el.points) {
      expect(el.x + px).toBeLessThanOrEqual(400);
      expect(el.y + py).toBeLessThanOrEqual(300);
    }
    const last = el.points[el.points.length - 1];
    expect([el.x + last[0], el.y + last[1]]).toEqual([390, 300]);
  });

  it("clamps a line being drawn", async () => {
    await renderWith(setup());
    UI.clickTool("line");
    drag([100, 100], [800, 100]);
    const line = h.elements[0] as any;
    const end = line.points[line.points.length - 1];
    expect(line.x + end[0]).toBe(400);
  });

  it("clamps the live segment of a multi-point line", async () => {
    await renderWith(setup());
    UI.clickTool("line");
    mouse.reset();
    mouse.clickAt(100, 100);
    mouse.moveTo(300, 150);
    mouse.moveTo(900, 150);
    const line = h.state.multiElement as any;
    expect(line).not.toBeNull();
    const end = line.points[line.points.length - 1];
    expect(line.x + end[0]).toBeLessThanOrEqual(400);
    Keyboard.keyPress("Escape");
  });

  it("stops a dragged rectangle at the right edge", async () => {
    await renderWith(setup());
    const rect = API.createElement({
      type: "rectangle",
      backgroundColor: "red",
      fillStyle: "solid",
      x: 100,
      y: 100,
      width: 100,
      height: 50,
    });
    API.setElements([rect]);
    mouse.reset();
    mouse.downAt(150, 125);
    mouse.moveTo(900, 125);
    mouse.upAt(900, 125);
    const r = h.elements[0];
    expect([r.x, r.y]).toEqual([300, 100]);
  });

  it("separate layout: dragging past the gap lands fully on page 1", async () => {
    await renderWith(setup());
    const rect = API.createElement({
      type: "rectangle",
      backgroundColor: "red",
      fillStyle: "solid",
      x: 100,
      y: 200,
      width: 100,
      height: 50,
    });
    API.setElements([rect]);
    mouse.reset();
    mouse.downAt(150, 225);
    mouse.moveTo(150, 225 + 150); // centre now at y = 400: page 1
    mouse.upAt(150, 225 + 150);
    const r = h.elements[0];
    expect(r.x).toBe(100);
    expect(r.y).toBeGreaterThanOrEqual(340);
    expect(r.y + r.height).toBeLessThanOrEqual(640);
  });

  it("continuous layout: content may cross a page break", async () => {
    await renderWith(setup({ layout: "continuous" }));
    const rect = API.createElement({
      type: "rectangle",
      backgroundColor: "red",
      fillStyle: "solid",
      x: 100,
      y: 200,
      width: 100,
      height: 50,
    });
    API.setElements([rect]);
    mouse.reset();
    mouse.downAt(150, 225);
    mouse.moveTo(150, 225 + 90);
    mouse.upAt(150, 225 + 90);
    expect(h.elements[0].y).toBe(290); // straddles the break at 300
  });

  it("clamps a resize at the page edge", async () => {
    await renderWith(setup());
    const rect = API.createElement({
      type: "rectangle",
      backgroundColor: "red",
      fillStyle: "solid",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    const handle = UI.resize(rect, "se", [1000, 1000]);
    void handle;
    const r = h.elements[0];
    expect(r.x + r.width).toBeLessThanOrEqual(400);
    expect(r.y + r.height).toBeLessThanOrEqual(300);
  });

  it("does not box-select, drag or erase from outside", async () => {
    await renderWith(setup());
    const rect = API.createElement({
      type: "rectangle",
      backgroundColor: "red",
      fillStyle: "solid",
      x: 350,
      y: 100,
      width: 50,
      height: 50,
    });
    API.setElements([rect]);
    drag([500, 120], [450, 120]);
    expect(h.state.selectionElement).toBeNull();
    drag([420, 90], [300, 160]);
    expect(h.state.selectedElementIds).toEqual({});
    Keyboard.keyPress("Escape");
  });
});

describe("page mode off: unchanged", () => {
  it.each([null, { ...setup(), enabled: false }])(
    "creates and drags freely outside the page area (%#)",
    async (pageSetup) => {
      await renderWith(pageSetup);
      UI.clickTool("rectangle");
      drag([450, 50], [900, 400]);
      expect(h.elements.length).toBe(1);
      const r = h.elements[0];
      expect([r.x, r.y, r.width, r.height]).toEqual([450, 50, 450, 350]);

      UI.clickTool("selection");
      mouse.reset();
      mouse.downAt(600, 200);
      mouse.moveTo(1600, 200);
      mouse.upAt(1600, 200);
      expect(h.elements[0].x).toBe(1450);
    },
  );
});
