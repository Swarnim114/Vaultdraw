import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { FakeVaultRepository } from "../src/tests/fakeVaultRepository";
import { SAMPLE_SCENE } from "../src/tests/fixtures";
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
}

(ownerWindow as any).__vaultRepo = repository;

void import("../src/VaultApp").then(({ default: VaultApp }) => {
  createRoot(mountNode).render(
    <StrictMode>
      <VaultApp
        ownerDocument={ownerDocument}
        ownerWindow={ownerWindow}
        repository={repository}
      />
    </StrictMode>,
  );
});
