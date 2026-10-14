import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { loadFromBlob } from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";

import { loadSceneFromJson } from "./loadScene";

const SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    {
      id: "a",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      version: 3,
      versionNonce: 7,
      isDeleted: false,
    },
    {
      id: "gone",
      type: "ellipse",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      isDeleted: true,
    },
  ],
  appState: {
    viewBackgroundColor: "#ffeeaa",
    gridModeEnabled: true,
    scrollX: 5,
    zoom: { value: 2 },
  },
  files: {
    f1: {
      id: "f1",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AAAA",
      created: 1,
    },
  },
});

// restore() draws a fresh versionNonce/seed for elements that lack them.
const stable = <T extends { elements: readonly object[] }>(scene: T) => ({
  ...scene,
  elements: scene.elements.map((e) => ({ ...e, versionNonce: 0, seed: 0 })),
});

describe("loadSceneFromJson", () => {
  it("matches loadFromBlob for a scene", async () => {
    const viaBlob = await loadFromBlob(
      new Blob([SCENE], { type: "application/json" }),
      null,
      null,
      null,
    );
    expect(stable(loadSceneFromJson(SCENE))).toEqual(stable(viaBlob));
  });

  it("matches loadFromBlob for the perf fixtures when present", async () => {
    const dir = process.env.PERF_FIXTURE_DIR;
    if (!dir) {
      return;
    }
    for (const name of readdirSync(dir).filter((n) =>
      /^perf-.*\.excalidraw$/.test(n),
    )) {
      const json = readFileSync(path.join(dir, name), "utf8");
      const viaBlob = await loadFromBlob(
        new Blob([json], { type: "application/json" }),
        null,
        null,
        null,
      );
      expect(stable(loadSceneFromJson(json))).toEqual(stable(viaBlob));
    }
  });

  it.each([
    "not json",
    "[]",
    '{"type":"other","elements":[]}',
    '{"type":"excalidrawlib","library":[]}',
  ])("rejects %s like loadFromBlob", async (bad) => {
    expect(() => loadSceneFromJson(bad)).toThrow("Error: invalid file");
    await expect(
      loadFromBlob(
        new Blob([bad], { type: "application/json" }),
        null,
        null,
        null,
      ),
    ).rejects.toThrow("Error: invalid file");
  });
});
