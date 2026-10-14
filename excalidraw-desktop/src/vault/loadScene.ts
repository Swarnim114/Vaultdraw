import { cleanAppStateForExport } from "@excalidraw/excalidraw/appState";
import { isValidExcalidrawData } from "@excalidraw/excalidraw/data/json";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";

/**
 * Scene JSON to editor initial data without the Blob round trip of `loadFromBlob`
 * (which copies the string into a Blob, then reads it back out as text: ~2 extra
 * copies of an up-to-32 MiB scene). Same parse and restore steps as
 * `loadSceneOrLibraryFromBlob` for an `.excalidraw` scene with no local state.
 */
export const loadSceneFromJson = (json: string) => {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Error: invalid file");
  }
  if (!isValidExcalidrawData(data)) {
    throw new Error("Error: invalid file");
  }
  const elements = restoreElements(data.elements, null, {
    repairBindings: true,
    deleteInvisibleElements: true,
  });
  return {
    elements,
    appState: restoreAppState(
      {
        theme: undefined,
        fileHandle: null,
        ...cleanAppStateForExport(data.appState || {}),
      },
      null,
    ),
    files: data.files || {},
  };
};
