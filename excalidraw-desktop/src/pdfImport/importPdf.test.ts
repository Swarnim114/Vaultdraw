import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PAGE_SETUP,
  getPageRect,
} from "@excalidraw/excalidraw/data/pageSetup";
import { validateFractionalIndices } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { rect } from "../page/testElements";
import { FakePdfBridge, makePages } from "../tests/fakePdfBridge";

import { importPdf } from "./importPdf";
import { DEFAULT_PDF_IMPORT_SETTINGS as S, PdfImportAborted } from "./types";

const setup = { ...DEFAULT_PAGE_SETUP, enabled: true, pageCount: 1 };

const makeApi = (
  elements: ExcalidrawElement[] = [],
  appState: Record<string, unknown> = {},
) => {
  const state = {
    zoom: { value: 1 },
    width: 1000,
    height: 800,
    pageSetup: null,
    viewBackgroundColor: "#fff",
    viewBackgroundPattern: null,
    ...appState,
  };
  const api = {
    getAppState: () => state,
    getSceneElementsIncludingDeleted: () => elements,
    getFiles: () => ({}),
    addFiles: vi.fn(),
    updateScene: vi.fn(),
  };
  return api as typeof api & Parameters<typeof importPdf>[0]["api"];
};

const setupImport = (n: number, bridgeOpts = {}) => {
  const bridge = new FakePdfBridge({ pages: makePages(n), ...bridgeOpts });
  const info = bridge.makeDoc("doc.pdf");
  return { bridge, info, indices: info.pages.map((_, i) => i) };
};

describe("importPdf", () => {
  it("commits once: files, locked image elements, provenance, valid indices", async () => {
    const existing = [rect(0, 0, 100, 100)];
    const api = makeApi(existing);
    const { bridge, info, indices } = setupImport(3);
    const progress: number[] = [];
    const result = await importPdf({
      api,
      bridge,
      info,
      indices,
      settings: S,
      onProgress: (p) => progress.push(p.done),
    });

    expect(result).toMatchObject({ imported: 3, skipped: [], truncated: 0 });
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.addFiles).toHaveBeenCalledTimes(1);
    const { elements, captureUpdate } = api.updateScene.mock.calls[0][0];
    expect(captureUpdate).toBe("IMMEDIATELY");
    expect(elements).toHaveLength(4);
    const pages = elements.slice(1);
    for (const [k, el] of pages.entries()) {
      expect(el).toMatchObject({
        type: "image",
        status: "saved",
        locked: true,
        scale: [1, 1],
        customData: { pdfImport: { name: "doc.pdf", page: k + 1 } },
      });
      expect(
        api.addFiles.mock.calls[0][0].some((f: any) => f.id === el.fileId),
      ).toBe(true);
    }
    expect(pages[0].y).toBeGreaterThan(100);
    expect(() =>
      validateFractionalIndices(elements, {
        shouldThrow: true,
        includeBoundTextValidation: false,
      }),
    ).not.toThrow();
    expect(bridge.closes).toEqual([info.token]);
  });

  it("builds data URLs with the right mime type", async () => {
    for (const format of ["jpeg", "png"] as const) {
      const api = makeApi();
      const { bridge, info, indices } = setupImport(1);
      await importPdf({
        api,
        bridge,
        info,
        indices,
        settings: { ...S, format },
      });
      const file = api.addFiles.mock.calls[0][0][0];
      expect(file.dataURL.startsWith(`data:image/${format};base64,`)).toBe(
        true,
      );
      expect(file.mimeType).toBe(`image/${format}`);
      expect(file.id).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("does not lock when lockPages is off", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(1);
    await importPdf({
      api,
      bridge,
      info,
      indices,
      settings: { ...S, lockPages: false },
    });
    expect(api.updateScene.mock.calls[0][0].elements[0].locked).toBe(false);
  });

  it("abort leaves the scene untouched and closes the token", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(5, { delayMs: 5 });
    const ac = new AbortController();
    const p = importPdf({
      api,
      bridge,
      info,
      indices,
      settings: S,
      signal: ac.signal,
      onProgress: ({ done }) => done === 2 && ac.abort(),
    });
    await expect(p).rejects.toBeInstanceOf(PdfImportAborted);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(api.addFiles).not.toHaveBeenCalled();
    expect(new Set(bridge.renders.map((r) => r.index))).toEqual(
      new Set([0, 1]),
    );
    expect(bridge.closes).toEqual([info.token]);
  });

  it("skips pages that fail and compacts placement", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(3, { failPages: [1] });
    const result = await importPdf({ api, bridge, info, indices, settings: S });
    expect(result.imported).toBe(2);
    expect(result.skipped).toEqual([1]);
    const els = api.updateScene.mock.calls[0][0].elements;
    expect(els.map((e: any) => e.customData.pdfImport.page)).toEqual([1, 3]);
  });

  it("rethrows other errors and still closes", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(2);
    bridge.renderPage = async () => {
      throw Object.assign(new Error("x"), { code: "PDF_BAD_TOKEN" });
    };
    await expect(
      importPdf({ api, bridge, info, indices, settings: S }),
    ).rejects.toThrow("x");
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(bridge.closes).toEqual([info.token]);
  });

  it("stops at the byte budget and commits what fits", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(40);
    // incompressible: 2 MB per page whatever the size asked for
    bridge.renderPage = async () => new Uint8Array(2_000_000);
    const result = await importPdf({ api, bridge, info, indices, settings: S });
    expect(result.imported).toBeGreaterThan(0);
    expect(result.imported).toBeLessThan(40);
    expect(result.imported + result.truncated).toBe(40);
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.updateScene.mock.calls[0][0].elements).toHaveLength(
      result.imported,
    );
  });

  it("re-renders an oversized page once at a smaller size", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(12, { bytesPerPx: 3 });
    await importPdf({ api, bridge, info, indices, settings: S });
    const first = bridge.renders[0].opts;
    const second = bridge.renders[1].opts;
    expect(bridge.renders[1].index).toBe(0);
    expect(second.maxSide).toBeLessThan(first.maxSide);
    expect(second.quality).toBeCloseTo(first.quality - 0.1);
  });

  it("page mode: fits pages, sets pageCount, no scroll", async () => {
    const api = makeApi([], { pageSetup: setup });
    const { bridge, info, indices } = setupImport(2);
    await importPdf({ api, bridge, info, indices, settings: S });
    const { elements, appState } = api.updateScene.mock.calls[0][0];
    expect(appState.pageSetup.pageCount).toBe(2);
    expect(appState.scrollX).toBeUndefined();
    elements.forEach((el: any, i: number) => {
      const slot = getPageRect(setup, i);
      expect(el.y).toBeGreaterThanOrEqual(slot.y);
      expect(el.y + el.height).toBeLessThanOrEqual(slot.y + slot.height);
    });
  });

  it("page mode: starts after content on page 2", async () => {
    const slot1 = getPageRect({ ...setup, pageCount: 3 }, 1);
    const api = makeApi([rect(10, slot1.y + 10, 40, 40)], {
      pageSetup: { ...setup, pageCount: 3 },
    });
    const { bridge, info, indices } = setupImport(1);
    await importPdf({ api, bridge, info, indices, settings: S });
    const { elements, appState } = api.updateScene.mock.calls[0][0];
    expect(appState.pageSetup.pageCount).toBe(3);
    expect(elements[1].y).toBeGreaterThanOrEqual(getPageRect(setup, 2).y);
  });

  it("normal mode scrolls the first page into view", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(1);
    await importPdf({ api, bridge, info, indices, settings: S });
    const { appState } = api.updateScene.mock.calls[0][0];
    expect(appState.scrollY).toBe(24);
    expect(typeof appState.scrollX).toBe("number");
  });

  it("commits nothing when every page fails", async () => {
    const api = makeApi();
    const { bridge, info, indices } = setupImport(1, { failPages: [0] });
    const result = await importPdf({ api, bridge, info, indices, settings: S });
    expect(result.imported).toBe(0);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(bridge.closes).toEqual([info.token]);
  });
});
