import { useCallback } from "react";

import {
  CaptureUpdateAction,
  useExcalidrawAPI,
  useExcalidrawStateValue,
} from "@excalidraw/excalidraw";

import type { BackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";

/** The current drawing's paper pattern and its setter. Call inside the Excalidraw tree. */
export const usePaperPattern = () => {
  const api = useExcalidrawAPI();
  const pattern = useExcalidrawStateValue("viewBackgroundPattern") ?? null;
  const readOnly = useExcalidrawStateValue("viewModeEnabled") ?? false;
  const theme = useExcalidrawStateValue("theme") ?? "light";

  const setPattern = useCallback(
    (next: BackgroundPattern | null) => {
      api?.updateScene({
        appState: { viewBackgroundPattern: next },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );
  const closeMenu = useCallback(
    () => api?.updateScene({ appState: { openMenu: null } }),
    [api],
  );

  return { pattern, setPattern, readOnly, theme, closeMenu };
};
