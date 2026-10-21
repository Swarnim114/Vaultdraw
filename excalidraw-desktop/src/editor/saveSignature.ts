import { getSceneVersion } from "@excalidraw/excalidraw";
import { backgroundPatternKey } from "@excalidraw/excalidraw/data/backgroundPattern";
import { pageSetupKey } from "@excalidraw/excalidraw/data/pageSetup";

import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

/** Changes when something that is saved to the file changed (scene, canvas background, paper, grid, page setup). */
export const getSaveSignature = (
  elements: readonly ExcalidrawElement[],
  appState: Pick<
    AppState,
    | "viewBackgroundColor"
    | "gridModeEnabled"
    | "viewBackgroundPattern"
    | "pageSetup"
  >,
  /** Version of the drawing's style overrides (they are saved with the file). */
  stylesVersion = 0,
) =>
  `${getSceneVersion(elements)}|${appState.viewBackgroundColor}|${
    appState.gridModeEnabled
  }|${backgroundPatternKey(appState.viewBackgroundPattern)}|${pageSetupKey(
    appState.pageSetup,
  )}|${stylesVersion}`;
