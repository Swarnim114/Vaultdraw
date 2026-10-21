import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CaptureUpdateAction,
  DefaultSidebar,
  Excalidraw,
  loadFromBlob,
  MainMenu,
} from "@excalidraw/excalidraw";
import { DEFAULT_SIDEBAR } from "@excalidraw/common";

import {
  LoadIcon,
  saveAs,
  settingsIcon,
} from "@excalidraw/excalidraw/components/icons";

import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ImageExportRequest,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";

import { isPdfFile } from "../canvasImport/importFiles";
import { useCanvasImportMenu } from "../canvasImport/useCanvasImportMenu";
import { CommandMenuItem } from "../commands/CommandMenuItem";
import { GRAPH_COMMAND_IDS } from "../commands/graphCommands";
import { IconGraph, IconHistory, IconLibrary } from "../components/Icons";
import { HISTORY_COMMAND_IDS } from "../history/historyCommands";
import { PaperDialog } from "../components/paper/PaperDialog";
import { PaperMenuItem } from "../components/paper/PaperMenuItem";
import { PageMenuItem } from "../components/page/PageMenuItem";
import { PageSetupDialog } from "../components/page/PageSetupDialog";
import { PageNotice } from "../page/PageNotice";
import { usePageMode } from "../page/usePageMode";
import { useVaultLibrary } from "../library/useVaultLibrary";
import { copyToClipboard } from "../vault/clipboard";
import { getPreferences, updatePreferences } from "../vault/preferences";

import { PenBar } from "../pens/PenBar";

import { usePens } from "../pens/usePens";
import { baseStyleAppState } from "../toolDefaults/baseStyle";
import { readDrawingStyles } from "../toolDefaults/drawingStyles";
import { useToolDefaults } from "../toolDefaults/useToolDefaults";
import { useFormulaCommands } from "../formula/useFormulaCommands";

import "../theme/excalidrawChrome.css";

import { registerCanvasRepaint, suspendCanvasSync } from "./canvasSync";
import { registerEditorApi } from "./editorApi";
import { registerEditorFlush } from "./editorFlush";
import { useEditorPalette } from "./useEditorPalette";
import { useVaultEditorLinks } from "./links/useVaultEditorLinks";
import {
  exportOptionsToAppState,
  loadExportOptions,
  rememberExportOptions,
} from "./exportOptions";
import { focusElement } from "./focusElement";
import { PANNED_CLASS, watchFirstPan } from "./panHint";
import { renderImageExport } from "./imageExport";
import { serializeSceneForSave } from "./sceneSerializer";
import { getSaveSignature } from "./saveSignature";

import type { EditorLinksWiring } from "./links/useVaultEditorLinks";
import type { ScenePoint } from "../canvasImport/useCanvasImport";
import type { SettingsTarget } from "../components/settings/schema";
import type { LibraryStore } from "../library/libraryStore";
import type { LibraryRepository } from "../library/types";
import type { EditorRestore } from "../tabs/useTabs";

import type { FlushOptions } from "./editorFlush";

import type { ComponentProps, DragEvent } from "react";

type Props = {
  documentId: string;
  /** Stable per-activation handle; read when the scene loads, not on render. */
  initialSource: { readonly json: string };
  name: string;
  onChange: (json: string) => void;
  onExport?: (name: string, bytes: Uint8Array) => Promise<boolean>;
  readOnly?: boolean;
  disabled?: boolean;
  theme?: "light" | "dark";
  onThemeChange?: (theme: "light" | "dark" | "system") => void;
  /** Opens Settings, on `page` when given (the pen bar opens "tools:pen"). */
  onOpenSettings?: (page?: SettingsTarget) => void;
  /** Main menu "Graph view": runs graph.open. */
  onOpenGraph?: () => void;
  /** Main menu "History": runs history.toggle. */
  onToggleHistory?: () => void;
  /** Select + scroll to an element once the scene is loaded (search results). */
  focusRequest?: {
    elementId: string;
    containerId: string | null;
    nonce: number;
  } | null;
  /** Persisted library; omit to run with Excalidraw's in-memory library. */
  library?: { store: LibraryStore; repository: LibraryRepository };
  /** Links (open/insert/hints, rename edits, re-measure); omit for none. */
  links?: EditorLinksWiring;
  /** PDF import (menu item, dropped PDFs); omit for none. */
  pdfImport?: { start: () => void; openFile: (file: File) => void };
  /** Canvas right-click "Import file…" (PDF or images at that point). */
  onImportFile?: (at?: ScenePoint) => unknown;
  /** Tabs: view for the first paint and the undo stacks to bring back. */
  restore?: EditorRestore;
};

type Snapshot = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>
>;
const IDLE_SERIALIZE_MS = 600;
const MAX_SERIALIZE_MS = 2500;

/** One keyed instance per vault document keeps editor history and image files isolated. */
const VaultEditorComponent = ({
  documentId,
  initialSource,
  name,
  onChange,
  onExport,
  readOnly = false,
  disabled = false,
  theme,
  onThemeChange,
  onOpenSettings,
  onOpenGraph,
  onToggleHistory,
  focusRequest = null,
  library,
  links,
  pdfImport,
  onImportFile,
  restore,
}: Props) => {
  const host = useRef<HTMLDivElement | null>(null);
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const hostRef = useCallback((el: HTMLDivElement | null) => {
    host.current = el;
    setHostEl(el);
  }, []);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const callbackRef = useRef(onChange);
  const exportRef = useRef(onExport);
  const nameRef = useRef(name);
  const openSettingsRef = useRef(onOpenSettings);
  const openGraphRef = useRef(onOpenGraph);
  const toggleHistoryRef = useRef(onToggleHistory);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const signature = useRef("");
  const pendingChanges = useRef(false);
  const fileRefs = useRef<BinaryFiles>({});
  const releasePreview = useRef<(() => void) | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [paperDialogOpen, setPaperDialogOpen] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const handledFocusNonce = useRef<number | null>(null);
  const [libraryApi, setLibraryApi] = useState<ExcalidrawImperativeAPI | null>(
    null,
  );
  const { libraryUIOptions, onAppState } = useVaultLibrary(library, libraryApi);
  const editorLinks = useVaultEditorLinks(libraryApi, hostEl, links);
  const pens = usePens(apiRef, !readOnly && !disabled);
  const onPenAppState = pens.onAppState;
  const scheduleSaveRef = useRef<() => void>(() => {});
  const toolDefaults = useToolDefaults(apiRef, !readOnly && !disabled, {
    onOverridesChange: () => scheduleSaveRef.current(),
  });
  const { getDrawingStyles, getOverridesVersion, loadDrawingStyles } =
    toolDefaults;
  const onToolAppState = toolDefaults.onAppState;
  useEditorPalette({
    apiRef,
    disabled,
    presets: pens.presets,
    activePen: pens.active,
    selectPen: pens.selectPen,
    openPaperSettings: () => setPaperDialogOpen(true),
    libraryStore: library?.store ?? null,
  });

  const formula = useFormulaCommands({
    apiRef,
    readOnly: readOnly || disabled,
  });

  const pageMode = usePageMode({
    apiRef,
    getWindow: () => host.current?.ownerDocument.defaultView ?? null,
    disabled,
    readOnly,
    openPageSetup: () => setPageSetupOpen(true),
  });
  const onPageChange = pageMode.onChange;

  // The "move canvas" hint disappears after the user's first pan (persisted).
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) {
      return;
    }
    if (getPreferences().hasPanned) {
      el.classList.add(PANNED_CLASS);
      return;
    }
    return watchFirstPan(
      el,
      () => apiRef.current?.getAppState().activeTool.type,
      () => {
        el.classList.add(PANNED_CLASS);
        updatePreferences({ hasPanned: true });
      },
    );
  }, []);

  const canvasContextMenuItems = useCanvasImportMenu(
    onImportFile,
    !readOnly && !disabled,
  );
  const pdfImportRef = useRef(pdfImport);
  pdfImportRef.current = pdfImport;
  const hasPdfImport = !!pdfImport;
  const canImportPdf = hasPdfImport && !readOnly && !disabled;
  const canImportPdfRef = useRef(canImportPdf);
  canImportPdfRef.current = canImportPdf;

  const guardSceneDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    // A dropped PDF opens the import dialog instead of Excalidraw's handling.
    const pdf = Array.from(event.dataTransfer.files).find(isPdfFile);
    if (pdf && pdfImportRef.current) {
      event.preventDefault();
      event.stopPropagation();
      if (canImportPdfRef.current) {
        pdfImportRef.current.openFile(pdf);
      }
      return;
    }
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
  nameRef.current = name;
  openSettingsRef.current = onOpenSettings;
  openGraphRef.current = onOpenGraph;
  const canOpenGraph = !!onOpenGraph;
  toggleHistoryRef.current = onToggleHistory;
  const canToggleHistory = !!onToggleHistory;
  const canExport = !!onExport;
  const canOpenSettings = !!onOpenSettings;

  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  const initialData = useCallback(async () => {
    const doc = host.current?.ownerDocument;
    if (!doc) {
      throw new Error("Editor document is not mounted");
    }
    try {
      const blob = new doc.defaultView!.Blob([initialSource.json], {
        type: "application/json",
      });
      const scene = await loadFromBlob(blob, null, null, null);
      // Never inherit a file handle or scene from a previously mounted editor.
      scene.appState = {
        ...scene.appState,
        ...exportOptionsToAppState(loadExportOptions()),
        // saved currentItem* never wins: base = [editor] over built-ins
        ...baseStyleAppState(getPreferences()),
        fileHandle: null,
        ...(restoreRef.current?.view && {
          scrollX: restoreRef.current.view.scrollX,
          scrollY: restoreRef.current.view.scrollY,
          zoom: {
            value: restoreRef.current.view.zoom as NormalizedZoomValue,
          },
        }),
      };
      loadDrawingStyles(readDrawingStyles(initialSource.json));
      return scene;
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
    // documentId: a new document must load fresh even with identical JSON.
    // The source is read at call time so it always yields the latest saved text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource, documentId]);

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
      serializeSceneForSave(
        current[0],
        current[1],
        current[2],
        getDrawingStyles(),
      ),
    );
  }, [getDrawingStyles]);

  const scheduleSave = useCallback(() => {
    pendingChanges.current = true;
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(serializePending, IDLE_SERIALIZE_MS);
    if (!maxTimer.current) {
      maxTimer.current = setTimeout(serializePending, MAX_SERIALIZE_MS);
    }
  }, [serializePending]);
  scheduleSaveRef.current = scheduleSave;

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

  useEffect(
    () =>
      apiReady && apiRef.current
        ? registerEditorApi(documentId, apiRef.current)
        : undefined,
    [documentId, apiReady],
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
      onToolAppState(appState);
      if (!ready.current) {
        return;
      }
      onPageChange(elements, appState);
      rememberExportOptions(appState);
      // The dialog's live preview must show standard colours, not theme sync.
      const previewing = appState.openDialog?.name === "imageExport";
      if (previewing && !releasePreview.current) {
        releasePreview.current = suspendCanvasSync();
      } else if (!previewing && releasePreview.current) {
        releasePreview.current();
        releasePreview.current = null;
      }
      const nextSignature = getSaveSignature(
        elements,
        appState,
        getOverridesVersion(),
      );
      const fileChanged =
        Object.keys(files).length !== Object.keys(fileRefs.current).length ||
        Object.keys(files).some((id) => files[id] !== fileRefs.current[id]);
      if (signature.current === nextSignature && !fileChanged) {
        return;
      }
      signature.current = nextSignature;
      fileRefs.current = files;
      scheduleSave();
    },
    [
      scheduleSave,
      getOverridesVersion,
      onAppState,
      onPenAppState,
      onToolAppState,
      onPageChange,
    ],
  );

  const onInitialize = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      setLibraryApi(api);
      latest.current = [
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
      ];
      signature.current = getSaveSignature(
        latest.current[0],
        latest.current[1],
        getOverridesVersion(),
      );
      fileRefs.current = latest.current[2];
      ready.current = true;
      onPageChange(latest.current[0], latest.current[1]);
      setApiReady(true);
    },
    [onPageChange, getOverridesVersion],
  );

  // Tabs: bring back this document's undo history (kept only when the file is
  // unchanged since it was captured; takeUndo returns nothing otherwise).
  useEffect(() => {
    const api = apiRef.current;
    if (!apiReady || !api) {
      return;
    }
    const undo = restoreRef.current?.takeUndo();
    if (undo) {
      api.history.import(undo as Parameters<typeof api.history.import>[0]);
    }
  }, [apiReady]);

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

  const onExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI | null) => {
    if (!api) {
      apiRef.current = null;
    }
  }, []);

  const saveCopy = useCallback(async () => {
    const api = apiRef.current;
    const mounted = host.current;
    if (!api || !mounted || !exportRef.current || exportingRef.current) {
      return;
    }
    const ownerDocument = mounted.ownerDocument;
    const baseName = nameRef.current.replace(/\.excalidraw$/i, "") || "Drawing";
    exportingRef.current = true;
    setExporting(true);
    try {
      const json = serializeSceneForSave(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        getDrawingStyles(),
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
      exportingRef.current = false;
      setExporting(false);
    }
  }, [getDrawingStyles]);

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

  // Excalidraw's memo bails out only when `children` is the same element tree,
  // so rebuild it only when something it shows changes (not on every
  // VaultApp render, e.g. each autosave status change).
  const editorChildren = useMemo(
    () => (
      <>
        {/* A book, not Excalidraw's "panel" glyph, which reads as a sidebar toggle. */}
        <DefaultSidebar.Trigger
          icon={<IconLibrary />}
          title="Library"
          tab={DEFAULT_SIDEBAR.defaultTab}
        />
        {/* Mirrors excalidraw.com's menu, with vault-safe export actions
              instead of open/save-as (the vault file is always the source). */}
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <CommandMenuItem
            commandId="file.saveCopy"
            icon={saveAs}
            onSelect={() => void saveCopy()}
            disabled={exporting || !canExport}
          >
            Save a copy…
          </CommandMenuItem>
          {hasPdfImport && (
            <CommandMenuItem
              commandId="file.importPdf"
              icon={LoadIcon}
              onSelect={() => pdfImportRef.current?.start()}
              disabled={!canImportPdf}
            >
              Import PDF…
            </CommandMenuItem>
          )}
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          {canOpenGraph && (
            <CommandMenuItem
              commandId={GRAPH_COMMAND_IDS.open}
              icon={<IconGraph strokeWidth="1.25" />}
              onSelect={() => openGraphRef.current?.()}
            >
              Graph view
            </CommandMenuItem>
          )}
          {canToggleHistory && (
            <CommandMenuItem
              commandId={HISTORY_COMMAND_IDS.toggle}
              icon={<IconHistory strokeWidth="1.25" />}
              onSelect={() => toggleHistoryRef.current?.()}
            >
              History
            </CommandMenuItem>
          )}
          {canOpenSettings && (
            <CommandMenuItem
              commandId="settings.open"
              icon={settingsIcon}
              onSelect={() => openSettingsRef.current?.()}
            >
              Vault settings
            </CommandMenuItem>
          )}
          <MainMenu.DefaultItems.ToggleTheme allowSystemTheme={false} />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <PaperMenuItem onOpenSettings={() => setPaperDialogOpen(true)} />
          <PageMenuItem onOpenSetup={() => setPageSetupOpen(true)} />
        </MainMenu>
        {formula.dialog}
        {pageSetupOpen && (
          <PageSetupDialog
            onClose={() => setPageSetupOpen(false)}
            ownerDocument={host.current?.ownerDocument}
          />
        )}
        {paperDialogOpen && (
          <PaperDialog
            onClose={() => setPaperDialogOpen(false)}
            ownerDocument={host.current?.ownerDocument}
          />
        )}
      </>
    ),
    [
      exporting,
      canExport,
      canOpenSettings,
      canOpenGraph,
      canToggleHistory,
      canImportPdf,
      hasPdfImport,
      saveCopy,
      paperDialogOpen,
      pageSetupOpen,
      formula.dialog,
    ],
  );

  return (
    <div
      ref={hostRef}
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
        onExcalidrawAPI={onExcalidrawAPI}
        onImageEdit={formula.onImageEdit}
        canvasContextMenuItems={canvasContextMenuItems}
        validateEmbeddable={false}
        viewModeEnabled={readOnly}
        interaction={disabled ? false : undefined}
        onExportImage={handleExportImage}
        onLinkOpen={editorLinks.onLinkOpen}
        aiEnabled={false}
        freedrawPen={pens.freedrawPen}
        currentItemStrokeWidth={toolDefaults.currentItemStrokeWidth}
        newTextStyle={toolDefaults.newTextStyle}
        newContainerStyle={toolDefaults.newContainerStyle}
        styleOverrides={toolDefaults.styleOverrides}
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
        {editorChildren}
      </Excalidraw>
      {editorLinks.overlays}
      {pageMode.notice && <PageNotice {...pageMode.notice} />}
      {pens.freedrawActive && !readOnly && !disabled && (
        <PenBar
          presets={pens.presets}
          shortcuts={pens.shortcuts}
          active={pens.active}
          onSelect={pens.selectPen}
          onOpenSettings={onOpenSettings && (() => onOpenSettings("tools:pen"))}
        />
      )}
    </div>
  );
};

export const VaultEditor = memo(VaultEditorComponent);
export default VaultEditor;
