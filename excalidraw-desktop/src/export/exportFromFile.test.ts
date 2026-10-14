import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";
import { IMAGE_FILE_ID, IMAGE_SCENE, SAMPLE_SCENE } from "../tests/fixtures";

import { exportDrawingFromVault, sceneToExportRequest } from "./exportFromFile";

const renderImageExport = vi.fn();
vi.mock("../editor/imageExport", () => ({
  renderImageExport: (...args: unknown[]) => renderImageExport(...args),
}));

const win = window as unknown as Window & typeof globalThis;
const options = { scale: 3, background: false, embedScene: true, dark: true };

const withDeleted = () => {
  const scene = JSON.parse(SAMPLE_SCENE);
  scene.elements = [
    ...scene.elements,
    { ...scene.elements[0], id: "gone", isDeleted: true },
  ];
  return JSON.stringify(scene);
};

const seeded = async () => {
  const repo = new FakeVaultRepository({ vaultName: "V" });
  repo.seedDrawing("A/Graphs.excalidraw", SAMPLE_SCENE);
  repo.seedDrawing("Photo.excalidraw", IMAGE_SCENE);
  await repo.chooseVault();
  return repo;
};

afterEach(() => vi.clearAllMocks());

describe("sceneToExportRequest", () => {
  it("restores the file and applies the export options", async () => {
    const json = withDeleted();
    const request = await sceneToExportRequest(
      json,
      "Graphs.excalidraw",
      "svg",
      options,
      win,
    );
    const live = JSON.parse(json).elements.filter((e: any) => !e.isDeleted);
    expect(request.type).toBe("svg");
    expect(request.name).toBe("Graphs.excalidraw");
    expect(request.elements.map((e) => e.id)).toEqual(
      live.map((e: any) => e.id),
    );
    expect(request.exportingFrame).toBeNull();
    expect(request.appState).toMatchObject({
      exportScale: 3,
      exportBackground: false,
      exportEmbedScene: true,
      exportWithDarkMode: true,
    });
  });

  it("carries embedded image files", async () => {
    const request = await sceneToExportRequest(
      IMAGE_SCENE,
      "Photo.excalidraw",
      "png",
      options,
      win,
    );
    expect(Object.keys(request.files)).toContain(IMAGE_FILE_ID);
  });
});

describe("exportDrawingFromVault", () => {
  it("renders PNG/SVG through the dialog's renderer and saves the bytes", async () => {
    const repo = await seeded();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    renderImageExport.mockResolvedValue({
      bytes,
      fileName: "Graphs.png",
      mime: "image/png",
    });
    await expect(
      exportDrawingFromVault({
        repository: repo,
        handle: repo.vault.handle,
        path: "A/Graphs.excalidraw",
        format: "png",
        options,
        win,
      }),
    ).resolves.toBe(true);
    expect(renderImageExport).toHaveBeenCalledTimes(1);
    expect(renderImageExport.mock.calls[0][0]).toMatchObject({
      type: "png",
      name: "Graphs.excalidraw",
    });
    expect(repo.exported).toEqual([{ name: "Graphs.png", bytes }]);
  });

  it("save a copy hands over the file's bytes unchanged, without rendering", async () => {
    const repo = await seeded();
    await exportDrawingFromVault({
      repository: repo,
      handle: repo.vault.handle,
      path: "A/Graphs.excalidraw",
      format: "copy",
      options,
      win,
    });
    expect(renderImageExport).not.toHaveBeenCalled();
    expect(repo.exported).toHaveLength(1);
    expect(repo.exported[0].name).toBe("Graphs.excalidraw");
    expect(new TextDecoder().decode(repo.exported[0].bytes)).toBe(SAMPLE_SCENE);
  });

  it("propagates render errors (e.g. an empty drawing)", async () => {
    const repo = await seeded();
    renderImageExport.mockRejectedValue(
      new Error("Cannot export an empty canvas."),
    );
    await expect(
      exportDrawingFromVault({
        repository: repo,
        handle: repo.vault.handle,
        path: "A/Graphs.excalidraw",
        format: "svg",
        options,
        win,
      }),
    ).rejects.toThrow("empty canvas");
    expect(repo.exported).toHaveLength(0);
  });
});
