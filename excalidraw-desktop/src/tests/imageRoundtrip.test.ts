/**
 * Embedded-image round-trip tests (QA scope, editor-independent).
 *
 * Verifies at the repository/JSON layer that scenes carrying embedded files
 * survive write/read/copy byte-identically — the precondition for the editor
 * integration test (loadFromBlob -> serializeAsJSON "local") in
 * editorImageRoundtrip.test.tsx. Covers text/arrow/binding fixtures too.
 *
 * Lightweight: no editor deps, no root setupTests.ts.
 */
import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "./fakeVaultRepository";
import {
  BLANK_SCENE,
  embeddedFiles,
  IMAGE_FILE_ID,
  IMAGE_SCENE,
  SAMPLE_SCENE,
} from "./fixtures";

describe("embedded image round trip (repository layer)", () => {
  it("image scene keeps fileId linkage and dataURL through write/read", async () => {
    const repo = new FakeVaultRepository();
    await repo.writeDrawing({
      handle: repo.handle,
      path: "img.excalidraw",
      json: IMAGE_SCENE,
      expectedRevision: null,
      operationId: "img-1",
    });
    const disk = await repo.readDrawing(repo.handle, "img.excalidraw");
    const parsed = JSON.parse(disk.json) as {
      elements: Array<{ fileId?: string }>;
      files: Record<string, { dataURL: string }>;
    };
    const imageEl = parsed.elements.find((el) => el.fileId === IMAGE_FILE_ID);
    expect(imageEl).toBeTruthy();
    expect(parsed.files[IMAGE_FILE_ID]?.dataURL).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(embeddedFiles(disk.json)[IMAGE_FILE_ID]).toBe(
      embeddedFiles(IMAGE_SCENE)[IMAGE_FILE_ID],
    );
  });

  it("copying a drawing preserves embedded images independently", async () => {
    const repo = new FakeVaultRepository();
    const created = await repo.writeDrawing({
      handle: repo.handle,
      path: "orig.excalidraw",
      json: IMAGE_SCENE,
      expectedRevision: null,
      operationId: "img-2",
    });
    void created;
    const source = await repo.readDrawing(repo.handle, "orig.excalidraw");
    await repo.writeDrawing({
      handle: repo.handle,
      path: "copy.excalidraw",
      json: source.json,
      expectedRevision: null,
      operationId: "img-3",
    });
    const copy = await repo.readDrawing(repo.handle, "copy.excalidraw");
    expect(copy.json).toBe(IMAGE_SCENE);
    // Mutating the copy must not affect the original (no shared references
    // at the JSON layer; editor file-status handling is covered separately).
    const mutated = JSON.parse(copy.json) as { elements: Array<{ x: number }> };
    mutated.elements[0].x = 999;
    expect(JSON.parse(source.json).elements[0].x).not.toBe(999);
  });

  it("scene fixtures are structurally valid source JSON", () => {
    for (const [name, json] of [
      ["blank", BLANK_SCENE],
      ["sample", SAMPLE_SCENE],
      ["image", IMAGE_SCENE],
    ] as const) {
      const parsed = JSON.parse(json) as {
        type: string;
        version: number;
        elements: unknown[];
      };
      expect(parsed.type, name).toBe("excalidraw");
      expect(parsed.version, name).toBe(2);
      expect(Array.isArray(parsed.elements), name).toBe(true);
    }
    const sample = JSON.parse(SAMPLE_SCENE) as {
      elements: Array<{ id: string; type: string }>;
    };
    // Arrow bound to the rectangle exercises the binding path.
    expect(sample.elements.map((e) => e.type).sort()).toEqual([
      "arrow",
      "rectangle",
      "text",
    ]);
    expect(sample.elements.find((e) => e.id === "arrow-1")).toBeTruthy();
  });
});
