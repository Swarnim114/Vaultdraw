import { describe, expect, it, vi } from "vitest";

import {
  createImageExportHandler,
  openImageExport,
} from "../history/preview/exportImage";
import { resolveFiles } from "../history/preview/resolveFiles";
import {
  computeRowWindow,
  HISTORY_ROW_HEIGHT,
} from "../history/panel/rowWindow";
import {
  createPanelThumbnails,
  HISTORY_THUMB_MAX_ELEMENTS,
} from "../history/panel/thumbnails";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

const { renderImageExport, copyToClipboard } = vi.hoisted(() => ({
  renderImageExport: vi.fn(),
  copyToClipboard: vi.fn(),
}));
vi.mock("../editor/imageExport", () => ({
  renderImageExport: (...a: unknown[]) => renderImageExport(...a),
}));
vi.mock("../vault/clipboard", () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}));

const SHA = "b".repeat(64);

describe("computeRowWindow", () => {
  it("mounts a bounded window at any scroll position and never leaves the list", () => {
    for (const total of [0, 1, 7, 500, 20_000]) {
      for (const scroll of [0, 1, 55, 56, 10_000, 5_000_000]) {
        const { start, end } = computeRowWindow(total, scroll, 600);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(total);
        expect(start).toBeLessThanOrEqual(end);
        // viewport rows + one partial + overscan both sides
        expect(end - start).toBeLessThanOrEqual(
          Math.ceil(600 / HISTORY_ROW_HEIGHT) + 1 + 12,
        );
      }
    }
  });

  it("includes the rows that are on screen", () => {
    const scroll = 100 * HISTORY_ROW_HEIGHT + 10;
    const { start, end } = computeRowWindow(500, scroll, 560);
    expect(start).toBeLessThanOrEqual(100);
    expect(end).toBeGreaterThan(100 + Math.floor(560 / HISTORY_ROW_HEIGHT));
  });
});

describe("panel thumbnail eligibility", () => {
  const t = createPanelThumbnails(async () => "{}");
  const v = (elementCount: number | null, availability = "local") =>
    ({ elementCount, availability } as any);

  it("renders local versions up to the cap only", () => {
    expect(t.eligible(v(0))).toBe(true);
    expect(t.eligible(v(HISTORY_THUMB_MAX_ELEMENTS))).toBe(true);
    expect(t.eligible(v(HISTORY_THUMB_MAX_ELEMENTS + 1))).toBe(false);
  });

  it("never renders unknown counts or versions that are not local", () => {
    expect(t.eligible(v(null))).toBe(false);
    expect(t.eligible(v(10, "downloading"))).toBe(false);
    expect(t.eligible(v(10, "missing"))).toBe(false);
  });

  it("the cap stays below the template renderer's own refusal limit", async () => {
    const { THUMBNAIL_MAX_ELEMENTS } = await import("../templates/thumbnails");
    expect(HISTORY_THUMB_MAX_ELEMENTS).toBeLessThanOrEqual(
      THUMBNAIL_MAX_ELEMENTS,
    );
  });
});

describe("openImageExport", () => {
  it("opens the dialog without recording an undo step, and refuses an empty version", () => {
    const updateScene = vi.fn();
    const api = { updateScene } as any;
    expect(openImageExport(api, { elementCount: 0 })).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
    expect(openImageExport(api, { elementCount: 3 })).toBe(true);
    const arg = updateScene.mock.calls[0][0];
    expect(arg.appState.openDialog).toEqual({ name: "imageExport" });
    expect(arg.captureUpdate).toBe("NEVER");
  });
});

describe("createImageExportHandler", () => {
  const win = {} as any;

  it("saves files through the native save with the rendered name", async () => {
    renderImageExport.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      fileName: "x.png",
    });
    const save = vi.fn().mockResolvedValue(true);
    await createImageExportHandler(save, () => win)({ type: "png" } as any);
    expect(save).toHaveBeenCalledWith("x.png", new Uint8Array([1]));
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("copies clipboard requests instead of saving", async () => {
    renderImageExport.mockResolvedValueOnce({
      bytes: new Uint8Array([2]),
      fileName: "x.svg",
    });
    const save = vi.fn();
    await createImageExportHandler(
      save,
      () => win,
    )({
      type: "clipboard-svg",
    } as any);
    expect(copyToClipboard).toHaveBeenCalledWith(
      "svg",
      new Uint8Array([2]),
      win,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects when the preview window is gone", async () => {
    await expect(
      createImageExportHandler(vi.fn(), () => null)({ type: "png" } as any),
    ).rejects.toThrow("not mounted");
  });
});

describe("resolveFiles", () => {
  const deps = (repository: FakeHistoryRepository, main = {}) => ({
    repository,
    handle: "h",
    mainFiles: () => main as any,
  });

  it("skips images that the version has no data for", async () => {
    const repo = new FakeHistoryRepository("h");
    const out = await resolveFiles(["missing"], {}, deps(repo));
    expect(out).toEqual({});
  });

  it("a blob that is gone fails the load instead of returning a broken image", async () => {
    const repo = new FakeHistoryRepository("h");
    await expect(
      resolveFiles(
        ["f1"],
        {
          f1: {
            mimeType: "image/png",
            dataURL: `data:image/png;base64,@vdblob:${SHA}.png`,
          },
        },
        deps(repo),
      ),
    ).rejects.toMatchObject({ code: "VERSION_GONE" });
  });

  it("rejects with AbortError when aborted while a blob loads", async () => {
    const repo = new FakeHistoryRepository("h");
    repo.putBlob(`${SHA}.png`, new Uint8Array([1, 2, 3]));
    const ctl = new AbortController();
    const pending = resolveFiles(
      ["f1"],
      {
        f1: {
          mimeType: "image/png",
          dataURL: `data:image/png;base64,@vdblob:${SHA}.png`,
        },
      },
      { ...deps(repo), signal: ctl.signal },
    );
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not treat a malformed token as a blob reference", async () => {
    const repo = new FakeHistoryRepository("h");
    const out = await resolveFiles(
      ["f1"],
      {
        f1: {
          mimeType: "image/png",
          dataURL: "data:image/png;base64,@vdblob:../../etc/passwd",
        },
      },
      deps(repo),
    );
    expect(repo.calls).not.toContain("readBlob");
    expect(out.f1.dataURL).toContain("@vdblob:../../etc/passwd");
  });
});
