import { useCallback } from "react";

import {
  CaptureUpdateAction,
  useExcalidrawAPI,
  useExcalidrawStateValue,
} from "@excalidraw/excalidraw";

import { getPageSetupPatch } from "./pageSetupChange";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

/** The current drawing's page setup (null = normal canvas) and its setter. Call inside the Excalidraw tree. */
export const usePageSetup = () => {
  const api = useExcalidrawAPI();
  const pageSetup = useExcalidrawStateValue("pageSetup") ?? null;
  const readOnly = useExcalidrawStateValue("viewModeEnabled") ?? false;

  const setPageSetup = useCallback(
    (changes: Partial<PageSetup>) => {
      if (!api) {
        return;
      }
      api.updateScene({
        appState: getPageSetupPatch(api.getAppState(), changes),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  return { pageSetup, setPageSetup, readOnly };
};
