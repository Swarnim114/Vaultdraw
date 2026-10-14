import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  Excalidraw,
  getSceneVersion,
  loadFromBlob,
  MainMenu,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import {
  mermaidLogoIcon,
  saveAs,
  settingsIcon,
} from "@excalidraw/excalidraw/components/icons";

import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ImageExportRequest,
} from "@excalidraw/excalidraw/types";

import { useVaultLibrary } from "../library/useVaultLibrary";
import { copyToClipboard } from "../vault/clipboard";

import { PenBar } from "../pens/PenBar";

import { usePens } from "../pens/usePens";

import { registerCanvasRepaint, suspendCanvasSync } from "./canvasSync";
import { registerEditorFlush } from "./editorFlush";
import {
  exportOptionsToAppState,
  loadExportOptions,
  rememberExportOptions,
} from "./exportOptions";
import { focusElement } from "./focusElement";
import { renderImageExport } from "./imageExport";

import type { SettingsPageId } from "../components/settings/schema";
import type { LibraryStore } from "../library/libraryStore";
import type { LibraryRepository } from "../library/types";

import type { FlushOptions } from "./editorFlush";

import type { ComponentProps, DragEvent } from "react";

type Props = {
  documentId: string;
  initialJson: string;
  name: string;
  onChange: (json: string) => void;
  onExport?: (name: string, bytes: Uint8Array) => Promise<boolean>;
  readOnly?: boolean;
  disabled?: boolean;
  theme?: "light" | "dark";
  onThemeChange?: (theme: "light" | "dark" | "system") => void;
  /** Opens Settings, on `page` when given (the pen bar opens "pens"). */
  onOpenSettings?: (page?: SettingsPageId) => void;
  /** Select + scroll to an element once the scene is loaded (search results). */
  focusRequest?: {
    elementId: string;
    containerId: string | null;
    nonce: number;
  } | null;
  /** Persisted library; omit to run with Excalidraw's in-memory library. */
  library?: { store: LibraryStore; repository: LibraryRepository };
};

type Snapshot = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>
>;
const IDLE_SERIALIZE_MS = 600;
const MAX_SERIALIZE_MS = 2500;

/** One keyed instance per vault document keeps editor history and image files isolated. */
const VaultEditorComponent = ({
  documentId,
  initialJson,
  name,
  onChange,
  onExport,
  readOnly = false,
  disabled = false,
  theme,
  onThemeChange,
  onOpenSettings,
  focusRequest = null,
  library,
}: Props) => {
  const host = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const callbackRef = useRef(onChange);
  const exportRef = useRef(onExport);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const signature = useRef("");
  const pendingChanges = useRef(false);
  const fileRefs = useRef<BinaryFiles>({});
  const releasePreview = useRef<(() => void) | null>(null);
  const [exporting, setExporting] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const handledFocusNonce = useRef<number | null>(null);
  const [libraryApi, setLibraryApi] = useState<ExcalidrawImperativeAPI | null>(
    null,
  );
  const { libraryUIOptions, onAppState } = useVaultLibrary(library, libraryApi);
  const pens = usePens(apiRef, !readOnly && !disabled);
  const onPenAppState = pens.onAppState;

  const guardSceneDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    // Files that carry a scene (.excalidraw/.json, or Excalidraw's
    // "embed scene" exports named *.excalidraw.png/.svg) would replace the
    // drawing. Plain images are inserted as image elements, so let them through.
    const mayReplaceScene = Array.from(event.dataTransfer.files).some(
      (file) =>
        /\.(excalidraw|json)$/i.test(file.name) ||
        /\.excalidraw\.(png|svg)$/i.test(file.name) ||
        file.type === "application/vnd.excalidraw+json",
    );
    if (mayReplaceScene && !event.shiftKey) {
      // The core editor normally replaces the scene on file drop. In a vault
      // that would autosave imported content over the current source file.
      event.preventDefault();
      event.stopPropagation();
      setEditorError(
        "To open another drawing, copy it into your vault and select it in the navigator. Hold Shift while dropping to insert content without replacing this drawing.",
      );
    } else if (mayReplaceScene) {
      setEditorError(null);
    }
  }, []);
  callbackRef.current = onChange;
  exportRef.current = onExport;

  const initialData = useCallback(async () => {
    const doc = host.current?.ownerDocument;
    if (!doc) {
      throw new Error("Editor document is not mounted");
    }
    try {
      const blob = new doc.defaultView!.Blob([initialJson], {
        type: "application/json",
      });
      const scene = await loadFromBlob(blob, null, null, null);
      // Never inherit a file handle or scene from a previously mounted editor.
      scene.appState = {
        ...scene.appState,
        ...exportOptionsToAppState(loadExportOptions()),
        fileHandle: null,
      };
      return scene;
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
    // documentId: a new document must load fresh even with identical JSON.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson, documentId]);

  const commitTextEditing = useCallback(() => {
    const mounted = host.current;
    const doc = mounted?.ownerDocument;
    const focused = doc?.activeElement;
    // Excalidraw's WYSIWYG editor commits its controlled text on blur. Only blur
    // when an explicit barrier (file switch, window close, save copy) is required.
    if (
      focused &&
      mounted?.contains(focused) &&
      (focused.matches('[contenteditable="true"]') ||
        focused.tagName === "TEXTAREA")
    ) {
      (focused as HTMLElement).blur();
    }
  }, []);

  const serializePending = useCallback(() => {
    // IMPORTANT: DO NOT call commitTextEditing() here!
    // Blurring during idle debounce removes focus while typing, which makes
    // subsequent keystrokes trigger canvas tool shortcuts.
    if (timer.current) {
      clearTimeout(timer.current);
    }
    if (maxTimer.current) {
      clearTimeout(maxTimer.current);
    }
    timer.current = maxTimer.current = null;
    const current = latest.current;
    if (!ready.current || !current || !pendingChanges.current) {
      return;
    }
    pendingChanges.current = false;
    callbackRef.current(
      serializeAsJSON(current[0], current[1], current[2], "local"),
    );
  }, []);

  const flushImmediate = useCallback(
    (options?: FlushOptions) => {
      if (options?.commitText) {
        commitTextEditing();
      }
      serializePending();
    },
    [commitTextEditing, serializePending],
  );

  useEffect(
    () => registerEditorFlush(documentId, flushImmediate),
    [documentId, flushImmediate],
  );

  // Canvas sync: the display colour transform changed (theme, mode, sync
  // toggle, export). Element caches invalidate on the next render, so force
  // one by re-committing the same elements (no history entry, no save: the
  // scene version is unchanged).
  useEffect(
    () =>
      registerCanvasRepaint(() => {
        const api = apiRef.current;
        if (!api || !ready.current) {
          return;
        }
        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted(),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }),
    [documentId],
  );

  const onEditorChange = useCallback(
    (elements: Snapshot[0], appState: Snapshot[1], files: Snapshot[2]) => {
      latest.current = [elements, appState, files];
      onAppState(appState);
      onPenAppState(appState);
      if (!ready.current) {
        return;
      }
      rememberExportOptions(appState);
      // The dialog's live preview must show standard colours, not theme sync.
      const previewing = appState.openDialog?.name === "imageExport";
      if (previewing && !releasePreview.current) {
        releasePreview.current = suspendCanvasSync();
      } else if (!previewing && releasePreview.current) {
        releasePreview.current();
        releasePreview.current = null;
      }
      const nextSignature = `${getSceneVersion(elements)}|${
        appState.viewBackgroundColor
      }|${appState.gridModeEnabled}`;
      const fileChanged =
        Object.keys(files).length !== Object.keys(fileRefs.current).length ||
        Object.keys(files).some((id) => files[id] !== fileRefs.current[id]);
      if (signature.current === nextSignature && !fileChanged) {
        return;
      }
      signature.current = nextSignature;
      fileRefs.current = files;
      pendingChanges.current = true;
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(serializePending, IDLE_SERIALIZE_MS);
      if (!maxTimer.current) {
        maxTimer.current = setTimeout(serializePending, MAX_SERIALIZE_MS);
      }
    },
    [serializePending, onAppState, onPenAppState],
  );

  const onInitialize = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    setLibraryApi(api);
    latest.current = [
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
    ];
    signature.current = `${getSceneVersion(latest.current[0])}|${
      latest.current[1].viewBackgroundColor
    }|${latest.current[1].gridModeEnabled}`;
    fileRefs.current = latest.current[2];
    ready.current = true;
    setApiReady(true);
  }, []);

  // Search results: focus the requested element once per request, after the
  // scene is loaded and laid out.
  useEffect(() => {
    if (!apiReady || !focusRequest) {
      return;
    }
    if (handledFocusNonce.current === focusRequest.nonce) {
      return;
    }
    handledFocusNonce.current = focusRequest.nonce;
    const win = host.current?.ownerDocument.defaultView;
    let ran = false;
    const run = () => {
      ran = true;
      const api = apiRef.current;
      if (api) {
        focusElement(api, focusRequest);
      }
    };
    const frame = win ? win.requestAnimationFrame(run) : null;
    return () => {
      if (frame !== null && !ran) {
        win?.cancelAnimationFrame(frame);
        // Cancelled before it ran (StrictMode remount): allow a retry.
        handledFocusNonce.current = null;
      }
    };
  }, [apiReady, focusRequest]);

  useEffect(
    () => () => {
      ready.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
      }
      if (maxTimer.current) {
        clearTimeout(maxTimer.current);
      }
      timer.current = maxTimer.current = null;
      apiRef.current = null;
      releasePreview.current?.();
      releasePreview.current = null;
    },
    [documentId],
  );

  const saveCopy = async () => {
    const api = apiRef.current;
    const mounted = host.current;
    if (!api || !mounted || !exportRef.current || exporting) {
      return;
    }
    const ownerDocument = mounted.ownerDocument;
    const baseName = name.replace(/\.excalidraw$/i, "") || "Drawing";
    setExporting(true);
    try {
      const json = serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      );
      const blob = new ownerDocument.defaultView!.Blob([json], {
        type: "application/json",
      });
      await exportRef.current(
        `${baseName}.excalidraw`,
        new Uint8Array(await blob.arrayBuffer()),
      );
      setEditorError(null);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };

  // Every image export (dialog, shortcuts, context menu copy) lands here.
  // Throwing makes the editor show its own error.
  const handleExportImage = useCallback(async (request: ImageExportRequest) => {
    const win = host.current?.ownerDocument.defaultView;
    if (!win) {
      throw new Error("Editor window is not mounted");
    }
    const started = performance.now();
    const image = await renderImageExport(request, win);
    const rendered = performance.now();
    if (request.type === "clipboard" || request.type === "clipboard-svg") {
      await copyToClipboard(
        request.type === "clipboard" ? "png" : "svg",
        image.bytes,
        win,
      );
    } else if (exportRef.current) {
      // false = the user cancelled the save dialog, not an error.
      await exportRef.current(image.fileName, image.bytes);
    } else {
      throw new Error("Exporting files is not available.");
    }
    // eslint-disable-next-line no-console
    console.debug(
      `[export] ${request.type} render ${Math.round(
        rendered - started,
      )} ms, ipc ${Math.round(performance.now() - rendered)} ms, ${
        image.bytes.byteLength
      } bytes`,
    );
  }, []);

  return (
    <div
      ref={host}
      className="vault-editor"
      data-document-id={documentId}
      onDropCapture={guardSceneDrop}
    >
      {editorError && <div role="alert">{editorError}</div>}
      <Excalidraw
        name={name}
        theme={theme}
        onThemeChange={onThemeChange}
        handleKeyboardGlobally={true}
        autoFocus={true}
        initialData={initialData}
        onChange={onEditorChange}
        onInitialize={onInitialize}
        onExcalidrawAPI={(api) => {
          if (!api) {
            apiRef.current = null;
          }
        }}
        validateEmbeddable={false}
        viewModeEnabled={readOnly}
        interaction={disabled ? false : undefined}
        onExportImage={handleExportImage}
        aiEnabled={false}
        freedrawPen={pens.freedrawPen}
        laserPointerOptions={pens.laserPointerOptions}
        libraryUIOptions={libraryUIOptions}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: true,
          },
        }}
      >
        {/* Mirrors excalidraw.com's menu, with vault-safe export actions
            instead of open/save-as (the vault file is always the source). */}
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Item
            icon={saveAs}
            onSelect={() => void saveCopy()}
            disabled={exporting || !onExport}
          >
            Save a copy…
          </MainMenu.Item>
          <MainMenu.Item
            icon={mermaidLogoIcon}
            onSelect={() =>
              apiRef.current?.updateScene({
                appState: { openDialog: { name: "ttd", tab: "mermaid" } },
              })
            }
            disabled={readOnly}
          >
            Insert Mermaid diagram…
          </MainMenu.Item>
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          {onOpenSettings && (
            <MainMenu.Item
              icon={settingsIcon}
              onSelect={() => onOpenSettings()}
            >
              Vault settings
            </MainMenu.Item>
          )}
          <MainMenu.DefaultItems.ToggleTheme allowSystemTheme={false} />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
      {pens.freedrawActive && !readOnly && !disabled && (
        <PenBar
          presets={pens.presets}
          shortcuts={pens.shortcuts}
          active={pens.active}
          onSelect={pens.selectPen}
          onOpenSettings={onOpenSettings && (() => onOpenSettings("pens"))}
        />
      )}
    </div>
  );
};

export const VaultEditor = memo(VaultEditorComponent);
export default VaultEditor;
