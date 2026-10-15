import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";
import { renderBackgroundPattern } from "@excalidraw/excalidraw/renderer/backgroundPattern";

import { FakeLibraryRepository } from "../src/tests/fakeLibraryRepository";
import { FakeVaultRepository } from "../src/tests/fakeVaultRepository";
import { FakeVaultLinks } from "../src/tests/fakeVaultLinks";
import { FakeVaultSearch } from "../src/tests/fakeVaultSearch";
import { SAMPLE_SCENE, SEARCH_SCENE } from "../src/tests/fixtures";
import {
  setAutosaveDelayMs,
  updatePreferences,
} from "../src/vault/preferences";

import "../src/desktop.css";

import { E2E_AUTOSAVE_MS } from "./constants";
import {
  smallScene,
  TEMPLATE_BACKGROUNDS,
  templateScene,
} from "./templateFixtures";

// Browser-only harness for Playwright: mounts the real VaultApp backed by the
// in-memory FakeVaultRepository so the editor can be driven with real input.
const mountNode = document.getElementById("root")!;
const ownerDocument = mountNode.ownerDocument;
const ownerWindow = ownerDocument.defaultView!;
const params = new ownerWindow.URLSearchParams(ownerWindow.location.search);

ownerWindow.__EXCALIDRAW_DESKTOP__ = true;
ownerWindow.EXCALIDRAW_ASSET_PATH = new ownerWindow.URL(
  "./",
  ownerWindow.location.href,
).href;
// Short autosave so specs don't sit through the 500ms production default.
setAutosaveDelayMs(
  Number(params.get("autosave")) || E2E_AUTOSAVE_MS,
  ownerWindow,
);
if (params.get("chrome") === "macos") {
  ownerDocument.documentElement.classList.add("vault-macos");
}
if (params.get("theme") === "dark") {
  ownerDocument.documentElement.classList.add("dark");
}

const repository = new FakeVaultRepository({
  vaultName: "E2E Vault",
  readOnly: params.get("readonly") === "1",
});
if (params.get("seed") !== "empty") {
  repository.seedFolder("DSA/Dynamic Programming");
  repository.seedDrawing(
    "DSA/Dynamic Programming/01 Introduction.excalidraw",
    SAMPLE_SCENE,
  );
  repository.seedDrawing("DSA/Graphs.excalidraw", SAMPLE_SCENE);
  if (params.get("seed") === "search") {
    // Opt-in (?seed=search): keeps other specs' drawing counts unchanged.
    repository.seedDrawing("DSA/Shortest Paths.excalidraw", SEARCH_SCENE);
  }
  if (params.get("seed") === "bigfolder") {
    // Opt-in (?seed=bigfolder): one folder of 500 drawings (tree windowing).
    for (let i = 0; i < 500; i++) {
      repository.seedDrawing(
        `Zbig/note ${String(i).padStart(3, "0")}.excalidraw`,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [],
          appState: {},
          files: {},
        }),
      );
    }
  }
  if (params.get("seed") === "searchheavy") {
    // Opt-in (?seed=searchheavy): 300 drawings with 6 text elements each that
    // all contain "note", so a short query returns the full 50 drawings x 5
    // snippets (search results rendering latency).
    for (let i = 0; i < 300; i++) {
      const elements = [0, 1, 2, 3, 4, 5].map((k) => ({
        id: `t-${i}-${k}`,
        type: "text",
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        roundness: null,
        link: null,
        locked: false,
        frameId: null,
        boundElements: [],
        x: 0,
        y: k * 30,
        width: 200,
        height: 25,
        text: `Meeting note ${i} item ${k}: remember the roadmap`,
        originalText: `Meeting note ${i} item ${k}: remember the roadmap`,
        fontSize: 20,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        containerId: null,
        lineHeight: 1.25,
        autoResize: true,
      }));
      repository.seedDrawing(
        `Notes ${i % 10}/Note ${i}.excalidraw`,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements,
          appState: {},
          files: {},
        }),
      );
    }
  }
  if (params.get("seed") === "names5k") {
    // Opt-in (?seed=names5k): 5,000 small drawings in nested folders, for the
    // quick switcher's per-keystroke latency measurement.
    const words = [
      "alpha",
      "design",
      "vault",
      "roadmap",
      "notes",
      "sketch",
      "graph",
      "plan",
      "review",
      "draft",
    ];
    const empty = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [],
      appState: {},
      files: {},
    });
    for (let i = 0; i < 5000; i++) {
      const top = `Area ${i % 25}`;
      const sub = `${words[i % 10]} ${Math.floor(i / 250) % 8}`;
      repository.seedDrawing(
        `${top}/${sub}/${words[(i * 7) % 10]} ${
          words[(i * 3) % 10]
        } ${i}.excalidraw`,
        empty,
      );
    }
  }
}

if (params.get("seed") === "tags") {
  // Opt-in (?seed=tags): tagged drawings plus text that must NOT become tags
  // (URL fragment, hex colour).
  const textScene = (...texts: string[]) =>
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "e2e-tags",
      elements: texts.map((text, i) => ({
        id: `t${i}`,
        type: "text",
        x: 0,
        y: i * 40,
        width: 200,
        height: 25,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        roundness: null,
        link: null,
        locked: false,
        isDeleted: false,
        text,
        originalText: text,
        fontSize: 20,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        containerId: null,
        lineHeight: 1.25,
      })),
      appState: {},
      files: {},
    });
  repository.seedDrawing(
    "DSA/Tagged Graphs.excalidraw",
    textScene("BFS traversal #dsa/graphs", "mock round #Interview"),
  );
  repository.seedDrawing(
    "DSA/Tagged Arrays.excalidraw",
    textScene("two pointers #dsa"),
  );
  repository.seedDrawing(
    "DSA/Not Tags.excalidraw",
    textScene("see https://example.com/page#frag", "colour #ff00aa"),
  );
}

if (params.get("seed") === "templates") {
  // Opt-in (?seed=templates): vault templates, plus one in a custom folder.
  for (const [name, background] of Object.entries(TEMPLATE_BACKGROUNDS)) {
    repository.seedDrawing(
      `Templates/${name}.excalidraw`,
      templateScene(name.replace(/\W/g, ""), background),
    );
  }
  repository.seedDrawing(
    "Custom Tpl/Sprint Retro.excalidraw",
    templateScene("SprintRetro", "#d3f9d8"),
  );
}
// ?templates=N (perf): N small-scene templates in Templates/.
const templateCount = Number(params.get("templates")) || 0;
for (let i = 0; i < templateCount; i++) {
  const path = `Templates/Template ${String(i).padStart(3, "0")}.excalidraw`;
  repository.seedDrawing(path, smallScene(i));
  // Stable mtime: thumbnail cache keys (path + mtime + size) survive reopen.
  repository.setModified(path, 1_700_000_000_000);
}

if (params.get("seed") === "links") {
  // Opt-in (?seed=links): text links, a shape link, an unresolved link, an
  // ambiguous basename (Folder A/Dupe, Folder B/Dupe) and a folder.
  const base = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    roundness: null,
    locked: false,
    frameId: null,
    isDeleted: false,
  };
  // Clear of the hamburger menu, toolbar and left properties panel.
  const OX = 180;
  const OY = 200;
  const text = (id: string, t: string, y: number, extra = {}) => ({
    ...base,
    id,
    type: "text",
    x: 20 + OX,
    y: y + OY,
    width: 360,
    height: 25,
    text: t,
    originalText: t,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    lineHeight: 1.25,
    link: null,
    boundElements: [],
    ...extra,
  });
  const scene = (...elements: object[]) =>
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "e2e-links",
      elements,
      appState: {},
      files: {},
    });
  repository.seedFolder("Folder A");
  repository.seedFolder("Folder B");
  repository.seedFolder("Folder");
  repository.seedDrawing(
    "Hub.excalidraw",
    scene(
      text("hub-t1", "See [[Alpha]] now", 20),
      text("hub-t2", "Todo [[Missing Note]]", 80),
      text("hub-t3", "Which [[Dupe]]?", 140),
      {
        ...base,
        id: "hub-shape",
        type: "rectangle",
        x: 20 + OX,
        y: 220 + OY,
        width: 160,
        height: 80,
        link: "[[Alpha]]",
        boundElements: [],
      },
    ),
  );
  repository.seedDrawing(
    "Alpha.excalidraw",
    scene(text("alpha-t1", "Back to [[Hub]]", 20)),
  );
  repository.seedDrawing(
    "Folder/Inner.excalidraw",
    scene(text("inner-t1", "Points at [[Alpha]]", 20)),
  );
  repository.seedDrawing(
    "Folder A/Dupe.excalidraw",
    scene(text("dupe-a", "dupe A", 20)),
  );
  repository.seedDrawing(
    "Folder B/Dupe.excalidraw",
    scene(text("dupe-b", "dupe B", 20)),
  );
}

// ?names=N (links perf): N empty drawings with realistic names in nested
// folders, for the `[[` autocomplete at 10k names.
const nameCount = Number(params.get("names")) || 0;
if (nameCount > 0) {
  const words = [
    "alpha",
    "design",
    "vault",
    "roadmap",
    "notes",
    "sketch",
    "graph",
    "plan",
    "review",
    "draft",
  ];
  const empty = JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [],
    appState: {},
    files: {},
  });
  for (let i = 0; i < nameCount; i++) {
    repository.seedDrawing(
      `Gen ${i % 40}/${words[i % 10]} ${Math.floor(i / 400) % 10}/${
        words[(i * 7) % 10]
      } ${words[(i * 3) % 10]} ${i}.excalidraw`,
      empty,
    );
  }
}

const libraryRepository = new FakeLibraryRepository();
const vaultLinks = new FakeVaultLinks(repository);
(ownerWindow as any).__vaultLinks = vaultLinks;

(ownerWindow as any).__vaultRepo = repository;
(ownerWindow as any).__updatePreferences = updatePreferences;
// Paper perf spec: the canvas renderer, for a micro-benchmark.
(ownerWindow as any).__paperRenderer = {
  createBackgroundPattern,
  renderBackgroundPattern,
};
// Paper zoom perf spec: commits one zoom step (React update + static canvas
// render) synchronously so its cost can be timed.
(ownerWindow as any).__flushSync = flushSync;
(ownerWindow as any).__libraryRepo = libraryRepository;

void import("../src/VaultApp").then(({ default: VaultApp }) => {
  createRoot(mountNode).render(
    <StrictMode>
      <VaultApp
        ownerDocument={ownerDocument}
        ownerWindow={ownerWindow}
        repository={repository}
        search={new FakeVaultSearch(repository)}
        links={vaultLinks}
        libraryRepository={libraryRepository}
      />
    </StrictMode>,
  );
});
