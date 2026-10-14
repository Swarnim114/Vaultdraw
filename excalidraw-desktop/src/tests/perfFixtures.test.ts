/**
 * Regression test for the perf fixture generator: a reduced vault is
 * generated into a temp dir and its open targets must load through the same
 * restore path the editor uses, with element counts intact.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { loadFromBlob } from "@excalidraw/excalidraw";

// @ts-ignore plain ESM module shared with the node perf runner
import { ensureVault } from "../../perf/lib/fixtures.mjs";
import baseConfig from "../../perf/fixtures.config.json";

const config = {
  ...baseConfig,
  drawingCount: 20,
  bigFolder: { path: "Journal/2024", drawings: 5 },
  openTargetSpecs: {
    small: { elements: 50, textRatio: 0.3, images: 0 },
    medium: { elements: 200, textRatio: 0.3, images: 0 },
    large: { elements: 300, textRatio: 0.3, images: 2, imageTotalMB: 0.1 },
  },
  imageHeavy: [{ path: "Media/heavy.excalidraw", imageTotalMB: 0.2 }],
};

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-fixtures-"));

afterAll(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

const load = async (vaultDir: string, rel: string) => {
  const json = fs.readFileSync(path.join(vaultDir, rel), "utf8");
  return loadFromBlob(
    new Blob([json], { type: "application/json" }),
    null,
    null,
    null,
  );
};

describe("perf fixtures", () => {
  it("generates a vault whose open targets restore intact", async () => {
    const { vaultDir, manifest } = await ensureVault({
      cacheDir,
      config,
      log: () => {},
    });

    expect(manifest.bigFolder.drawings).toBe(5);
    expect(fs.existsSync(path.join(vaultDir, config.needle.path))).toBe(true);
    expect(manifest.searchQueries[config.needle.query]).toBe(1);

    const small = await load(vaultDir, config.openTargets.small);
    expect(small.elements).toHaveLength(50);

    const medium = await load(vaultDir, config.openTargets.medium);
    expect(medium.elements).toHaveLength(200);
    const target = medium.elements.find(
      (el) => el.id === config.typingTarget.elementId,
    );
    expect(target).toMatchObject({
      type: "rectangle",
      x: config.typingTarget.x,
      y: config.typingTarget.y,
      width: config.typingTarget.width,
      height: config.typingTarget.height,
    });
    expect(medium.appState.scrollX).toBe(0);
    expect(medium.appState.zoom.value).toBe(1);

    const large = await load(vaultDir, config.openTargets.large);
    expect(large.elements).toHaveLength(300);
    expect(Object.keys(large.files)).toHaveLength(2);

    const heavy = await load(vaultDir, "Media/heavy.excalidraw");
    expect(heavy.elements.filter((el) => el.type === "image")).toHaveLength(2);
  });

  it("reuses the cached vault on a second call", async () => {
    const logs: string[] = [];
    await ensureVault({ cacheDir, config, log: (m: string) => logs.push(m) });
    expect(logs.join("\n")).toContain("reusing");
  });
});
