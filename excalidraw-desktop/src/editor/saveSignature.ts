import { getSceneVersion } from "@excalidraw/excalidraw";
import { backgroundPatternKey } from "@excalidraw/excalidraw/data/backgroundPattern";

import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

/** Changes when something that is saved to the file changed (scene, canvas background, paper, grid). */
export const getSaveSignature = (
  elements: readonly ExcalidrawElement[],
  appState: Pick<
    AppState,
    "viewBackgroundColor" | "gridModeEnabled" | "viewBackgroundPattern"
  >,
) =>
  `${getSceneVersion(elements)}|${appState.viewBackgroundColor}|${
    appState.gridModeEnabled
  }|${backgroundPatternKey(appState.viewBackgroundPattern)}`;
