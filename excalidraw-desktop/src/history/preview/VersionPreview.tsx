/**
 * Read-only second editor that shows one history version. One instance is
 * reused across versions (`updateScene` with NEVER). Nothing is persisted:
 * no onChange save, no library callbacks, no module-level caches.
 *
 * The editor package shares one module-level jotai store between instances
 * (editorJotaiStore), so the library atom is shared with the main editor.
 * The preview never loads or changes library items (no initialData
 * libraryItems, no onLibraryChange, default UI and the library hidden), so it
 * never writes them.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  ImageExportRequest,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";

import { createImageExportHandler } from "./exportImage";

import "./preview.css";

import type { LoadedVersion } from "./versionCache";

export interface VersionPreviewProps {
  version: LoadedVersion | null;
  /** Main editor viewport at mount (scrollX, scrollY, zoom). */
  initialViewport: { scrollX: number; scrollY: number; zoom: number } | null;
  theme: "light" | "dark";
  onApi?: (api: ExcalidrawImperativeAPI | null) => void;
  /** Selection count changed (enables "Copy to current drawing"). */
  onSelectionChange?: (count: number) => void;
  /** Native save for the image export dialog (fileName, bytes). */
  onSaveFile?: (fileName: string, bytes: Uint8Array) => Promise<unknown>;
  /** Default file name of exported images. */
  name?: string;
}

const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: null,
    saveAsImage: true,
  },
  tools: { image: false },
} as const;

const INTERACTION = { enabled: { select: true, navigation: true } } as const;

const addMissingFiles = (
  api: ExcalidrawImperativeAPI,
  files: LoadedVersion["files"],
) => {
  const have = api.getFiles();
  const missing = Object.values(files).filter((f) => !have[f.id]);
  if (missing.length) {
    api.addFiles(missing);
  }
};

const toInitialData = (
  version: LoadedVersion,
  initialViewport: VersionPreviewProps["initialViewport"],
) => ({
  elements: version.elements,
  files: version.files,
  appState: {
    ...version.appState,
    ...(initialViewport && {
      scrollX: initialViewport.scrollX,
      scrollY: initialViewport.scrollY,
      zoom: { value: initialViewport.zoom as NormalizedZoomValue },
    }),
  },
  scrollToContent: !initialViewport,
});

const VersionPreview = ({
  version,
  initialViewport,
  theme,
  onApi,
  onSelectionChange,
  onSaveFile,
  name,
}: VersionPreviewProps) => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appliedId = useRef<string | null>(null);
  const selectionCount = useRef(0);
  const callbacks = useRef({ onApi, onSelectionChange, onSaveFile });
  callbacks.current = { onApi, onSelectionChange, onSaveFile };

  // The first non-null version goes in as initialData: one pass, no empty
  // flash. Taken lazily, so a mount before the version has loaded still works.
  const initialRef = useRef<ReturnType<typeof toInitialData> | null>(null);
  if (!initialRef.current && version) {
    initialRef.current = toInitialData(version, initialViewport);
  }
  const initialData = initialRef.current;
  if (version && appliedId.current === null && initialData) {
    appliedId.current = version.id;
  }

  const handleApi = useCallback((next: ExcalidrawImperativeAPI | null) => {
    setApi(next);
    callbacks.current.onApi?.(next);
  }, []);

  useEffect(
    () => () => {
      callbacks.current.onApi?.(null);
    },
    [],
  );

  useEffect(() => {
    if (!api || !version) {
      return;
    }
    if (appliedId.current !== version.id) {
      appliedId.current = version.id;
      api.updateScene({
        elements: version.elements,
        appState: version.appState as AppState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    // Images arrive later (on settle): a files-only update.
    if (version.imagesLoaded) {
      addMissingFiles(api, version.files);
    }
  }, [api, version]);

  const onChange = useCallback(
    (_elements: unknown, appState: { selectedElementIds: object }) => {
      const count = Object.keys(appState.selectedElementIds).length;
      if (count !== selectionCount.current) {
        selectionCount.current = count;
        callbacks.current.onSelectionChange?.(count);
      }
    },
    [],
  );

  const onExportImage = useCallback((request: ImageExportRequest) => {
    const save = callbacks.current.onSaveFile;
    if (!save) {
      return Promise.reject(new Error("Exporting files is not available."));
    }
    return createImageExportHandler(
      save,
      () => hostRef.current?.ownerDocument.defaultView as any,
    )(request);
  }, []);

  if (!version || !initialData) {
    return null;
  }
  return (
    <div ref={hostRef} className="vault-version-preview">
      <Excalidraw
        name={name}
        theme={theme}
        ui={false}
        interaction={INTERACTION}
        initialData={initialData}
        onExcalidrawAPI={handleApi}
        onChange={onChange as never}
        onExportImage={onExportImage}
        UIOptions={UI_OPTIONS as never}
        autoFocus={false}
        aiEnabled={false}
        validateEmbeddable={false}
      />
    </div>
  );
};

export default memo(VersionPreview);
