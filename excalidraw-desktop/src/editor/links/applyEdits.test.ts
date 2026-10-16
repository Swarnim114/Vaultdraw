import { describe, expect, it } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { applyEdits } from "./applyEdits";

const frame = (id: string, name: string) =>
  ({
    id,
    type: "frame",
    name,
    isDeleted: false,
    version: 1,
    versionNonce: 1,
  } as any);

const apiOver = (elements: any[]) => {
  const updates: any[] = [];
  const api = {
    getSceneElementsIncludingDeleted: () => elements,
    updateScene: (u: any) => updates.push(u),
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updates };
};

describe("applyEdits: frame names", () => {
  it("sets the name of a frame in one undoable update", () => {
    const { api, updates } = apiOver([frame("f1", "#a"), frame("f2", "x")]);
    expect(
      applyEdits(api, [{ elementId: "f1", field: "name", value: "#b" }]),
    ).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].captureUpdate).toBe("IMMEDIATELY");
    expect(updates[0].elements.map((e: any) => e.name)).toEqual(["#b", "x"]);
  });

  it("ignores unknown ids", () => {
    const { api, updates } = apiOver([frame("f1", "#a")]);
    expect(
      applyEdits(api, [{ elementId: "zz", field: "name", value: "#b" }]),
    ).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
