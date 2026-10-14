import {
  DEFAULT_SIDEBAR,
  LIBRARY_DISABLED_TYPES,
  LIBRARY_SIDEBAR_TAB,
  randomId,
} from "@excalidraw/common";
import { deepCopyElement } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import { libraryAddNamingAtom } from "../components/LibraryUnit";
import { editorJotaiStore } from "../editor-jotai";
import { t } from "../i18n";

import { register } from "./register";

export const actionAddToLibrary = register({
  name: "addToLibrary",
  trackEvent: { category: "element" },
  perform: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });

    for (const type of LIBRARY_DISABLED_TYPES) {
      if (selectedElements.some((element) => element.type === type)) {
        return {
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
          appState: {
            ...appState,
            errorMessage: t(`errors.libraryElementTypeError.${type}`),
          },
        };
      }
    }

    const libraryUIOptions = app.props.libraryUIOptions;
    if (libraryUIOptions?.namedItems) {
      // items need a name: open the library with the add tile's name field
      // (default target: the first section that takes new items)
      const section = libraryUIOptions.sections?.list.find(
        (section) => section.canAdd !== false,
      );
      editorJotaiStore.set(libraryAddNamingAtom, section?.id ?? "");
      return {
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
        appState: {
          ...appState,
          openSidebar: { name: DEFAULT_SIDEBAR.name, tab: LIBRARY_SIDEBAR_TAB },
        },
      };
    }

    return app.library
      .getLatestLibrary()
      .then((items) => {
        return app.library.setLibrary([
          {
            id: randomId(),
            status: "unpublished",
            elements: selectedElements.map(deepCopyElement),
            created: Date.now(),
          },
          ...items,
        ]);
      })
      .then(() => {
        return {
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
          appState: {
            ...appState,
            toast: { message: t("toast.addedToLibrary") },
          },
        };
      })
      .catch((error) => {
        return {
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
          appState: {
            ...appState,
            errorMessage: error.message,
          },
        };
      });
  },
  label: "labels.addToLibrary",
});
