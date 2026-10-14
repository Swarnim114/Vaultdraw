import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SETUP,
  getFitPageWidthZoom,
  type PageSetup,
} from "@excalidraw/excalidraw/data/pageSetup";
import { constrainScrollState } from "@excalidraw/excalidraw/viewport";

import {
  getPageStepScroll,
  getPageViewLock,
  PAGE_SIDE_MARGIN,
  PAGE_TOP_MARGIN,
  reconcilePageView,
  type PageViewMemory,
  type PageViewState,
} from "./pageView";

const setup: PageSetup = { ...DEFAULT_PAGE_SETUP, pageCount: 3 };
const state = (over: Partial<PageViewState> = {}): PageViewState => ({
  pageSetup: setup,
  width: 1000,
  height: 800,
  zoom: { value: 1 as any },
  scrollX: 0,
  scrollY: 0,
  scrollConstraints: null,
  ...over,
});

describe("getPageViewLock", () => {
  it("boxes the page column, locks scroll and zoom, min zoom = half the fit zoom", () => {
    const lock = getPageViewLock(setup, 1000, 800);
    const fit = getFitPageWidthZoom(setup, 1000, PAGE_SIDE_MARGIN);
    expect(lock.fitZoom).toBe(fit);
    expect(lock.constraints).toMatchObject({
      x: 0,
      y: 0,
      width: setup.width,
      height: 3 * (setup.height + 40) - 40,
      lockScroll: true,
      lockZoom: true,
      overscroll: 0,
      zoom: fit / 2,
      offsets: { left: 24, right: 24, top: 24, bottom: 320 },
    });
  });

  it("at fit zoom the page fills the width exactly: no sideways pan", () => {
    const lock = getPageViewLock(setup, 1000, 800);
    const a = constrainScrollState({
      ...state(),
      zoom: { value: lock.fitZoom as any },
      scrollX: -500,
      scrollConstraints: lock.constraints,
    });
    const b = constrainScrollState({
      ...state(),
      zoom: { value: lock.fitZoom as any },
      scrollX: 500,
      scrollConstraints: lock.constraints,
    });
    expect(a.scrollX).toBeCloseTo(b.scrollX, 6);
  });
});

describe("reconcilePageView", () => {
  it("does nothing when page mode is off and nothing was installed", () => {
    expect(reconcilePageView(state({ pageSetup: null }), null)).toBeNull();
  });

  it("opens fit-width at the top of page 1", () => {
    const result = reconcilePageView(state(), null)!;
    const fit = getFitPageWidthZoom(setup, 1000, PAGE_SIDE_MARGIN);
    const patch = result.patch as any;
    expect(patch.zoom.value).toBeCloseTo(fit, 6);
    expect(patch.scrollY).toBeCloseTo(PAGE_TOP_MARGIN / fit, 3);
    expect(patch.scrollX).toBeCloseTo(PAGE_SIDE_MARGIN / fit, 3);
    expect(patch.scrollConstraints).not.toBeNull();
    expect(result.memory!.fitZoom).toBe(fit);
  });

  it("is a no-op while the lock is in place and nothing changed", () => {
    const first = reconcilePageView(state(), null)!;
    const installed = state({
      ...(first.patch as any),
    });
    expect(reconcilePageView(installed, first.memory)).toBeNull();
  });

  it("re-installs when something cleared the lock, keeping the zoom", () => {
    const first = reconcilePageView(state(), null)!;
    const cleared = state({
      ...(first.patch as any),
      scrollConstraints: null,
    });
    const again = reconcilePageView(cleared, first.memory)!;
    expect(again.patch.scrollConstraints).not.toBeNull();
    expect((again.patch as any).zoom.value).toBeCloseTo(
      (first.patch as any).zoom.value,
      6,
    );
  });

  it("keeps the zoom / fit-zoom ratio on window resize", () => {
    const first = reconcilePageView(state(), null)!;
    const zoomedIn = state({
      ...(first.patch as any),
      zoom: { value: ((first.patch as any).zoom.value * 2) as any },
    });
    const resized = reconcilePageView(
      { ...zoomedIn, width: 1400 },
      first.memory,
    )!;
    const newFit = getFitPageWidthZoom(setup, 1400, PAGE_SIDE_MARGIN);
    expect((resized.patch as any).zoom.value).toBeCloseTo(newFit * 2, 5);
  });

  it("re-installs when the page count grows", () => {
    const first = reconcilePageView(state(), null)!;
    const installed = state({ ...(first.patch as any) });
    const grown = reconcilePageView(
      { ...installed, pageSetup: { ...setup, pageCount: 4 } },
      first.memory,
    )!;
    expect(grown.patch.scrollConstraints!.height).toBe(
      4 * (setup.height + 40) - 40,
    );
  });

  it("clears the lock when page mode turns off, once", () => {
    const first = reconcilePageView(state(), null)!;
    const off = reconcilePageView(
      state({
        ...(first.patch as any),
        pageSetup: { ...setup, enabled: false },
      }),
      first.memory,
    )!;
    expect(off.patch).toEqual({ scrollConstraints: null });
    expect(off.memory).toBeNull();
    expect(
      reconcilePageView(state({ pageSetup: null }), off.memory),
    ).toBeNull();
  });

  it("waits for a measured viewport", () => {
    expect(reconcilePageView(state({ width: 0 }), null)).toBeNull();
  });
});

describe("getPageStepScroll", () => {
  const open = () => {
    const first = reconcilePageView(state(), null)!;
    return state({ ...(first.patch as any) });
  };

  it("next page puts page 2's top at the viewport top, previous goes back", () => {
    const s = open();
    const next = getPageStepScroll(s, 1)!;
    const zoom = s.zoom.value;
    expect(next.scrollY).toBeCloseTo(
      -(setup.height + 40) + PAGE_TOP_MARGIN / zoom,
      4,
    );
    const at2 = { ...s, scrollY: next.scrollY };
    const back = getPageStepScroll(at2, -1)!;
    expect(back.scrollY).toBeCloseTo(PAGE_TOP_MARGIN / zoom, 4);
    expect(getPageStepScroll({ ...s }, -1)).toBeNull();
  });

  it("continuous layout steps by the page height", () => {
    const cont = { ...setup, layout: "continuous" as const };
    const first = reconcilePageView(state({ pageSetup: cont }), null)!;
    const s = state({ ...(first.patch as any), pageSetup: cont });
    const next = getPageStepScroll(s, 1)!;
    expect(next.scrollY).toBeCloseTo(
      -cont.height + PAGE_TOP_MARGIN / s.zoom.value,
      4,
    );
  });

  it("does nothing with page mode off", () => {
    expect(getPageStepScroll(state({ pageSetup: null }), 1)).toBeNull();
  });
});

export type { PageViewMemory };
