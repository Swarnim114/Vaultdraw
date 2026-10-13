import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  serializeLibraryAsJSON,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import { DEFAULT_SIDEBAR, LIBRARY_SIDEBAR_TAB } from "@excalidraw/common";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  LibraryUIOptions,
} from "@excalidraw/excalidraw/types";

import { LibraryStore } from "./libraryStore";

import type { LibraryRepository } from "./types";

const encoder = new TextEncoder();

/**
 * Connects the editor to the app-wide LibraryStore: persistence adapter,
 * external-change pushes, sidebar-open trigger, UI options and error toasts.
 */
/** Used when the editor has no persisted library (tests, previews). */
const INERT_REPOSITORY: LibraryRepository = {
  readLibrary: async () => ({
    json: null,
    revision: null,
    unchanged: false,
    path: "",
    readOnly: true,
  }),
  writeLibrary: async () => ({ revision: "" }),
  pickLibraryFile: async () => null,
  exportFile: async () => false,
  subscribe: async () => () => {},
};
const INERT_STORE = new LibraryStore(INERT_REPOSITORY);

export const useVaultLibrary = (
  library: { store: LibraryStore; repository: LibraryRepository } | undefined,
  editorApi: ExcalidrawImperativeAPI | null,
) => {
  const store = library?.store ?? INERT_STORE;
  const repository = library?.repository ?? INERT_REPOSITORY;
  const api = library ? editorApi : null;
  useHandleLibrary({ excalidrawAPI: api, adapter: store.adapter });

  const version = useSyncExternalStore(
    useCallback((cb) => store.subscribe(() => cb()), [store]),
    () => store.getVersion(),
  );

  // Push merges of external edits (and vault switches) into the editor.
  useEffect(() => {
    if (!api) {
      return;
    }
    return store.subscribe((kind) => {
      if (kind === "external") {
        void api.updateLibrary({ libraryItems: store.union(), merge: false });
      }
    });
  }, [api, store]);

  // Toast each distinct problem once.
  const toasted = useRef(new Set<string>());
  useEffect(() => {
    for (const message of store.getErrors()) {
      if (api && !toasted.current.has(message)) {
        toasted.current.add(message);
        api.setToast({ message, duration: 10000, closable: true });
      }
    }
  }, [api, store, version]);

  const onAppState = useCallback(
    (appState: Pick<AppState, "openSidebar">) => {
      const sidebar = appState.openSidebar;
      if (
        !store.isStarted() &&
        sidebar?.name === DEFAULT_SIDEBAR.name &&
        (sidebar.tab ?? LIBRARY_SIDEBAR_TAB) === LIBRARY_SIDEBAR_TAB
      ) {
        void store.loadNow();
      }
    },
    [store],
  );

  const libraryUIOptions = useMemo<LibraryUIOptions>(() => {
    const list = [
      {
        id: "personal",
        label: "Personal",
        emptyHint: "Items you add here are available in every vault.",
      },
      ...(store.hasVault()
        ? [
            {
              id: "vault",
              label: "This vault",
              canAdd: !store.isVaultReadOnly(),
              emptyHint:
                "Saved in library.excalidrawlib in this vault, so it travels with the vault.",
            },
          ]
        : []),
    ];
    return {
      online: false,
      sections: {
        list,
        sectionOf: store.sectionOf,
        assign: (ids, section) =>
          store.assign(ids, section === "vault" ? "vault" : "personal"),
      },
      pickLibraryFile: async () => {
        const picked = await repository.pickLibraryFile();
        return picked
          ? new Blob([picked.json], { type: "application/json" })
          : null;
      },
      saveLibraryFile: async (items, suggestedName) => {
        const name =
          suggestedName.replace(/\.excalidrawlib$/i, "") || "library";
        await repository.exportFile(
          `${name}.excalidrawlib`,
          encoder.encode(serializeLibraryAsJSON(items)),
        );
      },
    };
    // version: sections, sectionOf results and read-only state changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, repository, version]);

  return {
    libraryUIOptions: library ? libraryUIOptions : undefined,
    onAppState,
  };
};
