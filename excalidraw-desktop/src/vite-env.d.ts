/// <reference types="vite/client" />

interface Window {
  // Local asset base for bundled fonts/WASM/locales. Set in src/main.tsx from
  // `location.origin` before the VaultApp import (no inline scripts per CSP); the editor's font loader resolves against it so no
  // remote fallback is needed in desktop mode.
  EXCALIDRAW_ASSET_PATH: string | string[] | undefined;
  // Set by src/main.tsx; lets shared code detect the desktop shell.
  __EXCALIDRAW_DESKTOP__?: boolean;
  __EXCALIDRAW_SHA__?: string;
}
