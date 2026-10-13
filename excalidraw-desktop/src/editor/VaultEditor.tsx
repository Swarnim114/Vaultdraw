import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  getSceneVersion,
  loadFromBlob,
  MainMenu,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  ExportImageIcon,
  saveAs,
  settingsIcon,
} from "@excalidraw/excalidraw/components/icons";

import { registerEditorFlush } from "./editorFlush";

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
  onOpenSettings?: () => void;
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
  const [exporting, setExporting] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const guardSceneDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const mayReplaceScene = Array.from(event.dataTransfer.files).some(
      (file) =>
        /\.(excalidraw|json|png|svg)$/i.test(file.name) ||
        [
          "image/png",
          "image/svg+xml",
          "application/vnd.excalidraw+json",
        ].includes(file.type),
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
      scene.appState = { ...scene.appState, fileHandle: null };
      return scene;
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
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

  useEffect(() => {
    const doc = host.current?.ownerDocument;
    if (!doc) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        // Let Excalidraw's shortcut commit its WYSIWYG text editor; our flush
        // listener blurs/serializes the committed snapshot without replacing it.
        serializePending();
      }
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [documentId, serializePending]);

  const onEditorChange = useCallback(
    (elements: Snapshot[0], appState: Snapshot[1], files: Snapshot[2]) => {
      latest.current = [elements, appState, files];
      if (!ready.current) {
        return;
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
    [serializePending],
  );

  const onInitialize = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
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
  }, []);

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
    },
    [documentId],
  );

  const exportFormat = async (format: "png" | "svg" | "excalidraw") => {
    const api = apiRef.current;
    const mounted = host.current;
    if (!api || !mounted || !exportRef.current || exporting) {
      return;
    }
    const ownerDocument = mounted.ownerDocument;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const baseName = name.replace(/\.excalidraw$/i, "") || "Drawing";
    setExporting(true);
    try {
      let suffix: string;
      let blob: Blob;
      if (format === "excalidraw") {
        suffix = "excalidraw";
        blob = new ownerDocument.defaultView!.Blob(
          [serializeAsJSON(elements, appState, files, "local")],
          { type: "application/json" },
        );
      } else if (format === "png") {
        suffix = "png";
        blob = await exportToBlob({
          elements,
          appState,
          files,
          mimeType: "image/png",
        });
      } else {
        suffix = "svg";
        const svg = await exportToSvg({
          elements,
          appState,
          files,
          renderEmbeddables: false,
        });
        const Serializer = ownerDocument.defaultView!.XMLSerializer;
        blob = new ownerDocument.defaultView!.Blob(
          [new Serializer().serializeToString(svg)],
          { type: "image/svg+xml" },
        );
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await exportRef.current(`${baseName}.${suffix}`, bytes);
      setEditorError(null);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };

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
        aiEnabled={false}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
          },
        }}
      >
        {/* Mirrors excalidraw.com's menu, with vault-safe export actions
            instead of open/save-as (the vault file is always the source). */}
        <MainMenu>
          <MainMenu.Item
            icon={ExportImageIcon}
            onSelect={() => void exportFormat("png")}
            disabled={exporting || !onExport}
          >
            Export as PNG…
          </MainMenu.Item>
          <MainMenu.Item
            icon={ExportImageIcon}
            onSelect={() => void exportFormat("svg")}
            disabled={exporting || !onExport}
          >
            Export as SVG…
          </MainMenu.Item>
          <MainMenu.Item
            icon={saveAs}
            onSelect={() => void exportFormat("excalidraw")}
            disabled={exporting || !onExport}
          >
            Save a copy…
          </MainMenu.Item>
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          {onOpenSettings && (
            <MainMenu.Item icon={settingsIcon} onSelect={onOpenSettings}>
              Vault settings
            </MainMenu.Item>
          )}
          <MainMenu.DefaultItems.ToggleTheme allowSystemTheme={false} />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  );
};

export const VaultEditor = memo(VaultEditorComponent);
export default VaultEditor;
