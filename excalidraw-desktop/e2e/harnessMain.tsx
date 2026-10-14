import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { FakeLibraryRepository } from "../src/tests/fakeLibraryRepository";
import { FakeVaultRepository } from "../src/tests/fakeVaultRepository";
import { FakeVaultSearch } from "../src/tests/fakeVaultSearch";
import { SAMPLE_SCENE, SEARCH_SCENE } from "../src/tests/fixtures";
import { setAutosaveDelayMs } from "../src/vault/preferences";

import "../src/desktop.css";

import { E2E_AUTOSAVE_MS } from "./constants";

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

const repository = new FakeVaultRepository({ vaultName: "E2E Vault" });
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

const libraryRepository = new FakeLibraryRepository();

(ownerWindow as any).__vaultRepo = repository;
(ownerWindow as any).__libraryRepo = libraryRepository;

void import("../src/VaultApp").then(({ default: VaultApp }) => {
  createRoot(mountNode).render(
    <StrictMode>
      <VaultApp
        ownerDocument={ownerDocument}
        ownerWindow={ownerWindow}
        repository={repository}
        search={new FakeVaultSearch(repository)}
        libraryRepository={libraryRepository}
      />
    </StrictMode>,
  );
});
