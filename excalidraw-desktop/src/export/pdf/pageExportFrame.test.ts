import {
  createPageAreaExportFrame,
  createPageExportFrame,
  detachFromFrames,
} from "@excalidraw/excalidraw/data/pageExportFrame";
import { updatePageSetup } from "@excalidraw/excalidraw/data/pageSetup";
import { getElementsOverlappingFrame } from "@excalidraw/element";
import { describe, expect, it } from "vitest";

describe("page export frame", () => {
  it("is a frame-like element covering exactly the rect", () => {
    const frame = createPageExportFrame({ x: 0, y: 5, width: 10, height: 20 });
    expect(frame).toMatchObject({
      type: "frame",
      x: 0,
      y: 5,
      width: 10,
      height: 20,
      angle: 0,
      isDeleted: false,
    });
    expect(frame.id).toBeTruthy();
  });

  it("area frame covers every page and the gaps", () => {
    const setup = updatePageSetup(null, { layout: "separate", pageCount: 2 });
    const frame = createPageAreaExportFrame(setup);
    expect(frame.height).toBe(2 * setup.height + 40);
    expect(frame.width).toBe(setup.width);
  });

  it("selects elements by overlap, including those in real frames once detached", () => {
    const frame = createPageExportFrame({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const inside = {
      id: "a",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 5,
      height: 5,
      angle: 0,
      frameId: null,
    } as never;
    const crossing = {
      id: "b",
      type: "rectangle",
      x: 90,
      y: 90,
      width: 50,
      height: 50,
      angle: 0,
      frameId: null,
    } as never;
    const outside = {
      id: "c",
      type: "rectangle",
      x: 500,
      y: 500,
      width: 5,
      height: 5,
      angle: 0,
      frameId: null,
    } as never;
    const inRealFrame = {
      id: "d",
      type: "rectangle",
      x: 20,
      y: 20,
      width: 5,
      height: 5,
      angle: 0,
      frameId: "real",
    } as never;
    const all = [inside, crossing, outside, inRealFrame];
    const ids = (els: readonly { id: string }[]) => els.map((e) => e.id);
    const pick = (els: readonly any[]) =>
      ids(
        getElementsOverlappingFrame(
          els,
          frame,
          new Map(els.map((e) => [e.id, e])) as never,
        ),
      );
    expect(pick(all)).toEqual(["a", "b"]);
    expect(pick(detachFromFrames(all))).toEqual(["a", "b", "d"]);
    // no framed elements: the same array, no copy
    expect(detachFromFrames([inside])).toEqual([inside]);
  });
});
