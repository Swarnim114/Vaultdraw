import { describe, expect, it } from "vitest";

import { instantiateTemplate } from "./instantiate";

const scene = {
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [
    {
      id: "r1",
      type: "rectangle",
      groupIds: ["g1"],
      frameId: "f1",
      boundElements: [
        { id: "t1", type: "text" },
        { id: "a1", type: "arrow" },
        { id: "gone", type: "arrow" },
      ],
    },
    {
      id: "t1",
      type: "text",
      containerId: "r1",
      groupIds: ["g1"],
      frameId: "f1",
    },
    {
      id: "a1",
      type: "arrow",
      startBinding: { elementId: "r1", focus: 0, gap: 1 },
      endBinding: { elementId: "deleted", focus: 0, gap: 1 },
      groupIds: [],
    },
    { id: "f1", type: "frame", groupIds: [] },
    { id: "deleted", type: "rectangle", isDeleted: true, groupIds: [] },
  ],
  appState: { viewBackgroundColor: "#ffeecc", gridSize: 20 },
  files: { file1: { id: "file1", dataURL: "data:x" } },
};

const run = (opts = {}) =>
  JSON.parse(instantiateTemplate(JSON.stringify(scene), opts));

describe("instantiateTemplate", () => {
  it("remaps every id and drops deleted elements", () => {
    const out = run();
    expect(out.elements).toHaveLength(4);
    const oldIds = new Set(scene.elements.map((e) => e.id));
    for (const e of out.elements) {
      expect(oldIds.has(e.id)).toBe(false);
    }
    expect(new Set(out.elements.map((e: any) => e.id)).size).toBe(4);
  });

  it("keeps references consistent", () => {
    const [rect, text, arrow, frame] = run().elements;
    expect(text.containerId).toBe(rect.id);
    expect(rect.frameId).toBe(frame.id);
    expect(text.frameId).toBe(frame.id);
    expect(rect.groupIds[0]).not.toBe("g1");
    expect(rect.groupIds).toEqual(text.groupIds);
    expect(rect.boundElements.map((b: any) => b.id)).toEqual([
      text.id,
      arrow.id,
    ]);
    expect(arrow.startBinding.elementId).toBe(rect.id);
    expect(arrow.endBinding).toBeNull();
  });

  it("preserves files, appState and file metadata; sets theme", () => {
    const out = run({ theme: "dark" });
    expect(out.files).toEqual(scene.files);
    expect(out.appState).toMatchObject({
      viewBackgroundColor: "#ffeecc",
      gridSize: 20,
      theme: "dark",
    });
    expect(out.type).toBe("excalidraw");
    expect(out.source).toBe("test");
    expect(run().appState.theme).toBeUndefined();
  });

  it("gives different ids on each instantiation", () => {
    expect(run().elements[0].id).not.toBe(run().elements[0].id);
  });

  it("rejects non-scenes", () => {
    expect(() => instantiateTemplate("{}", {})).toThrow();
  });
});
