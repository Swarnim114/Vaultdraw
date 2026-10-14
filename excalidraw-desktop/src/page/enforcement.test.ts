import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SETUP } from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import { enforceChanged, planEnforcement } from "./enforcement";
import { arrow, boundText, rect, toMap, touch } from "./testElements";

const separate: PageSetup = { ...DEFAULT_PAGE_SETUP, pageCount: 2 };
const continuous: PageSetup = { ...separate, layout: "continuous" };
const W = separate.width;

const plan = (
  setup: PageSetup,
  elements: any[],
  changed: any[],
  selected: Record<string, true> = {},
) => planEnforcement(setup, elements, changed, selected, toMap(elements));

describe("planEnforcement", () => {
  it("leaves elements inside a page alone", () => {
    const a = rect(10, 10);
    expect(plan(separate, [a], [a]).size).toBe(0);
  });

  it("pulls a changed element back into the nearest page", () => {
    const a = rect(W + 50, 20);
    const moves = plan(separate, [a], [a]);
    expect(moves.get(a.id)).toEqual({ dx: W - (W + 50 + 100), dy: 0 });
  });

  it("moves an element in the gap to the nearest page", () => {
    const pitch = separate.height + 40;
    const a = rect(10, separate.height + 30, 100, 20); // centre in the gap, nearer page 2
    const moves = plan(separate, [a], [a]);
    expect(moves.get(a.id)!.dy).toBe(pitch - a.y);
  });

  it("ignores old out-of-page elements that were not changed", () => {
    const old = rect(-500, -500);
    const fresh = rect(10, 10);
    expect(plan(separate, [old, fresh], [fresh]).size).toBe(0);
  });

  it("ignores deleted elements", () => {
    const a = rect(-500, -500, 100, 60, { isDeleted: true });
    expect(plan(separate, [a], [a]).size).toBe(0);
  });

  it("moves a group together by its union bounds", () => {
    const a = rect(W - 50, 10, 100, 40, { groupIds: ["g"] });
    const b = rect(W - 200, 10, 100, 40, { groupIds: ["g"] });
    const moves = plan(separate, [a, b], [a]);
    // the union ends at W + 50: both move left by 50, though b is untouched
    expect(moves.get(a.id)).toEqual({ dx: -50, dy: 0 });
    expect(moves.get(b.id)).toEqual({ dx: -50, dy: 0 });
  });

  it("moves bound text with its container, judged through the container", () => {
    const { container, text } = boundText(rect(W - 20, 10, 100, 60));
    const moves = plan(separate, [container, text], [text]);
    expect(moves.get(container.id)).toEqual({ dx: -80, dy: 0 });
    expect(moves.get(text.id)).toEqual({ dx: -80, dy: 0 });
  });

  it("moves a frame with its children", () => {
    const frame = rect(W - 10, 10, 200, 200, {
      type: "frame",
      name: null,
    } as any);
    const child = rect(W + 20, 40, 50, 50, { frameId: frame.id });
    const moves = plan(separate, [frame, child], [frame]);
    expect(moves.get(frame.id)).toEqual({ dx: -190, dy: 0 });
    expect(moves.get(child.id)).toEqual({ dx: -190, dy: 0 });
  });

  it("moves outside elements of the selection as one set (keeps their layout)", () => {
    const a = rect(W + 10, 10, 50, 50);
    const b = rect(W + 100, 10, 50, 50);
    const moves = plan(separate, [a, b], [a, b], {
      [a.id]: true,
      [b.id]: true,
    });
    // union ends at W + 150 -> both left by 150
    expect(moves.get(a.id)).toEqual({ dx: -150, dy: 0 });
    expect(moves.get(b.id)).toEqual({ dx: -150, dy: 0 });
  });

  it("moves unselected outside elements independently", () => {
    const a = rect(W + 10, 10, 50, 50);
    const b = rect(W + 100, 10, 50, 50);
    const moves = plan(separate, [a, b], [a, b]);
    expect(moves.get(a.id)!.dx).toBe(-60);
    expect(moves.get(b.id)!.dx).toBe(-150);
  });

  it("continuous layout lets content straddle a page break", () => {
    const straddle = rect(10, separate.height - 20, 100, 60);
    expect(plan(continuous, [straddle], [straddle]).size).toBe(0);
    expect(plan(separate, [straddle], [straddle]).size).toBe(1);
  });

  it("aligns something bigger than the page to its top-left", () => {
    const big = rect(-50, -30, W + 400, 100);
    expect(plan(separate, [big], [big]).get(big.id)).toEqual({
      dx: 50,
      dy: 30,
    });
  });
});

describe("enforceChanged", () => {
  it("returns the same array when nothing moves", () => {
    const a = rect(10, 10);
    const elements = [a];
    expect(enforceChanged(separate, elements, [a], {}, toMap(elements))).toBe(
      elements,
    );
  });

  it("moves elements by new objects (version bumped), others keep identity", () => {
    const inside = rect(10, 10);
    const outside = rect(W + 10, 10);
    const elements = [inside, outside];
    const next = enforceChanged(
      separate,
      elements,
      [outside],
      {},
      toMap(elements),
    );
    expect(next[0]).toBe(inside);
    expect(next[1]).not.toBe(outside);
    expect(next[1].x).toBe(W - 100);
    expect(next[1].version).toBeGreaterThan(outside.version);
    expect(outside.x).toBe(W + 10); // the original is untouched
  });

  it("moves a bound arrow end along with the shape it is attached to", () => {
    const shape = rect(W + 10, 10, 100, 60, {
      boundElements: [{ type: "arrow", id: "arrow-1" }],
    });
    const link = arrow(W + 110, 40, 100, 0, {
      id: "arrow-1",
      startBinding: {
        elementId: shape.id,
        fixedPoint: [1, 0.5],
        mode: "orbit",
      } as any,
    });
    const elements = [shape, link];
    const next = enforceChanged(
      separate,
      elements,
      [shape],
      {},
      toMap(elements),
    );
    const movedShape = next[0];
    const movedArrow = next[1];
    expect(movedShape.x).toBeLessThan(shape.x);
    // the arrow start still sits at the shape's right edge (binding gap)
    expect(
      Math.abs(movedArrow.x - (movedShape.x + movedShape.width)),
    ).toBeLessThan(10);
    expect(movedArrow.x).toBeLessThan(link.x);
    expect(link.x).toBe(W + 110);
  });

  it("an already-corrected element is left alone on the next check", () => {
    const a = rect(W + 10, 10);
    const elements = [a];
    const next = enforceChanged(separate, elements, [a], {}, toMap(elements));
    const again = enforceChanged(
      separate,
      next,
      [touch(next[0])],
      {},
      toMap(next),
    );
    expect(again).toBe(next);
  });
});
