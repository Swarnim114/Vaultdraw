import { createRoot } from "react-dom/client";

import {
  Excalidraw,
  loadFromBlob,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

// A plain, unmodified Excalidraw editor (what excalidraw.com runs), used to
// check that a drawing saved by Vaultdraw opens there unchanged. Driven by
// compat/run.mjs.
(window as any).EXCALIDRAW_ASSET_PATH = new URL(
  "./",
  window.location.href,
).href;
(window as any).__lib = { loadFromBlob, restoreElements, serializeAsJSON };
createRoot(document.getElementById("root")!).render(
  <Excalidraw
    onExcalidrawAPI={(api: any) => {
      (window as any).api = api;
    }}
  />,
);
