import { test } from "node:test";
import assert from "node:assert/strict";
import { impactedSpecs, CORE_SPECS } from "./e2e-impact.mjs";

const SPECS = ["crud", "edge", "navigator", "commandPalette", "text", "tags", "tagsRename", "tagsPerf",
  "graphView", "graphApp", "hotkeys", "quickSwitcher", "menuHotkeys", "links", "linksWiring", "treeWindow", "search"];

test("folder keyword maps to specs with that prefix", () => {
  assert.deepEqual(impactedSpecs(["excalidraw-desktop/src/components/tags/TagRow.tsx"], SPECS).specs, ["tags", "tagsPerf", "tagsRename"]);
});
test("aliases cover irregular names", () => {
  assert.deepEqual(impactedSpecs(["excalidraw-desktop/src/commands/keymap.ts"], SPECS).specs,
    ["commandPalette", "hotkeys", "menuHotkeys", "quickSwitcher"]);
});
test("changed spec and helper", () => {
  assert.deepEqual(impactedSpecs(["excalidraw-desktop/e2e/search.spec.ts", "excalidraw-desktop/e2e/linksHelpers.ts"], SPECS).specs,
    ["links", "linksWiring", "search"]);
});
test("shared files and unmapped sources run the core set; unit tests and docs run nothing", () => {
  assert.deepEqual(impactedSpecs(["packages/element/src/bounds.ts"], SPECS).specs, [...CORE_SPECS].sort());
  assert.deepEqual(impactedSpecs(["excalidraw-desktop/src/somethingNew.ts"], SPECS).specs, [...CORE_SPECS].sort());
  assert.deepEqual(impactedSpecs(["excalidraw-desktop/src/tags/x.test.ts", "README.md", "excalidraw-desktop/src-tauri/src/lib.rs"], SPECS).specs, []);
  assert.deepEqual(impactedSpecs(["excalidraw-desktop/src/perf/probe.ts"], SPECS).specs, []);
});
