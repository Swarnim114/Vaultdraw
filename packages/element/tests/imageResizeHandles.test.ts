import { arrayToMap } from "@excalidraw/common";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { EditorInterface } from "@excalidraw/common";
import type { AppState, Zoom } from "@excalidraw/excalidraw/types";

import type { Radians } from "@excalidraw/math";

import { IMAGE_RESIZE_OUTER_BAND, resizeTest } from "../src/resizeTest";

// Vaultdraw (toimprove #35): the ring just outside a selected image resizes it
// instead of moving it.

const desktop = {
  formFactor: "desktop",
  desktopUIMode: "full",
  userAgent: { isMobileDevice: false, platform: "mac" },
  isTouchScreen: false,
  canFitSidebar: true,
  isLandscape: true,
} as unknown as EditorInterface;
const phone = {
  ...desktop,
  formFactor: "phone",
  userAgent: { isMobileDevice: true, platform: "ios" },
} as unknown as EditorInterface;

const zoom1 = { value: 1 } as Zoom;

const hit = (
  el: ReturnType<typeof API.createElement>,
  x: number,
  y: number,
  opts: { zoom?: Zoom; ui?: EditorInterface; selected?: boolean } = {},
) =>
  resizeTest(
    el as any,
    arrayToMap([el]),
    {
      selectedElementIds: opts.selected === false ? {} : { [el.id]: true },
    } as unknown as AppState,
    x,
    y,
    opts.zoom ?? zoom1,
    "mouse",
    opts.ui ?? desktop,
  );

describe("image resize handles", () => {
  const image = () =>
    API.createElement({ type: "image", x: 0, y: 0, width: 200, height: 120 });

  it("just outside each corner resizes from that corner", () => {
    const el = image();
    expect(hit(el, 205, 125)).toBe("se");
    expect(hit(el, 209, 129)).toBe("se");
    expect(hit(el, -6, -6)).toBe("nw");
    expect(hit(el, 207, -7)).toBe("ne");
    expect(hit(el, -7, 127)).toBe("sw");
  });

  it("just outside an edge resizes from that side", () => {
    const el = image();
    expect(hit(el, 206, 60)).toBe("e");
    expect(hit(el, 100, -8)).toBe("n");
    expect(hit(el, -9, 60)).toBe("w");
    expect(hit(el, 100, 128)).toBe("s");
  });

  it("the band is in screen px (scales with zoom)", () => {
    const el = image();
    const zoom2 = { value: 2 } as Zoom;
    const inside = (IMAGE_RESIZE_OUTER_BAND - 1) / 2;
    const outside = (IMAGE_RESIZE_OUTER_BAND + 1) / 2;
    expect(hit(el, 200 + inside, 60, { zoom: zoom2 })).toBe("e");
    expect(hit(el, 200 + outside, 60, { zoom: zoom2 })).toBe(false);
  });

  it("the image body still moves (no handle in the middle or far away)", () => {
    const el = image();
    expect(hit(el, 100, 60)).toBe(false);
    expect(hit(el, 30, 60)).toBe(false);
    expect(hit(el, 200 + IMAGE_RESIZE_OUTER_BAND + 2, 60)).toBe(false);
  });

  it("follows the rotation of the image", () => {
    const el = API.createElement({
      type: "image",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      angle: Math.PI as Radians,
    });
    // Rotated 180deg about the centre: the right edge is now on the left.
    expect(hit(el, -6, 60)).toBe("e");
  });

  it("not for unselected or locked images, nor for other shapes", () => {
    expect(hit(image(), 205, 125, { selected: false })).toBe(false);
    const locked = API.createElement({
      type: "image",
      width: 200,
      height: 120,
      locked: true,
    });
    expect(hit(locked, 205, 125)).toBe(false);
    const rect = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    });
    expect(hit(rect, 100, 128)).toBe(false);
  });

  it("phones (no side resizing) keep only the corners", () => {
    const el = image();
    expect(hit(el, 206, 60, { ui: phone })).toBe(false);
    expect(hit(el, 206, 126, { ui: phone })).toBe("se");
  });
});
