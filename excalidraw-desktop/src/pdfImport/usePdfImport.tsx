import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PdfImportAborted } from "./types";

import type {
  PdfBridge,
  PdfImportProgress,
  PdfImportResult,
  PdfImportSettings,
  PdfInfo,
} from "./types";

// The dialog and the importer stay out of the main chunk.
const PdfImportDialog = lazy(() => import("./PdfImportDialog"));

export type PdfImportNotify = (message: string, type: "error" | "info") => void;

export interface UsePdfImportOptions {
  bridge: PdfBridge;
  /** The editor API of the open drawing; undefined = nothing to import into. */
  getApi: () => ExcalidrawImperativeAPI | undefined;
  getSettings: () => PdfImportSettings;
  notify: PdfImportNotify;
}

export interface PdfImportControls {
  /** Native file picker, then the dialog. */
  start: () => Promise<void>;
  /** A PDF dropped on the canvas. */
  openFile: (file: File) => Promise<void>;
  /** Render this next to the app's other modals. */
  dialog: React.ReactNode;
}

type Session = {
  info: PdfInfo;
  api: ExcalidrawImperativeAPI;
  settings: PdfImportSettings;
};

export const pdfErrorMessage = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "PDF_ENCRYPTED") {
    return "This PDF is password-protected; Vaultdraw can't import it yet.";
  }
  if (code === "PDF_INVALID") {
    return "Not a readable PDF.";
  }
  if (code === "PDF_TOO_LARGE") {
    return "This PDF is too large to import.";
  }
  return "Couldn't import the PDF.";
};

const pages = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

export const importSummary = (
  result: PdfImportResult,
  settings: PdfImportSettings,
): string => {
  let text = `Imported ${pages(result.imported)}`;
  if (settings.lockPages && result.imported > 0) {
    text += " (locked; use Unlock all to edit them)";
  }
  if (result.truncated > 0) {
    text += `. ${pages(
      result.truncated,
    )} not imported: the drawing reached its size limit`;
  }
  if (result.skipped.length > 0) {
    text += `. ${pages(
      result.skipped.length,
    )} could not be rendered (${result.skipped.map((i) => i + 1).join(", ")})`;
  }
  return text;
};

/** Pick or drop a PDF, confirm in the dialog, import it into the open drawing. */
export const usePdfImport = ({
  bridge,
  getApi,
  getSettings,
  notify,
}: UsePdfImportOptions): PdfImportControls => {
  const [session, setSession] = useState<Session | null>(null);
  const [progress, setProgress] = useState<PdfImportProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Token of the open document, until the importer or a cancel closes it.
  const tokenRef = useRef<number | null>(null);
  // Latest options for stable callbacks (the editor is memoised on them).
  const live = useRef({ bridge, notify, getApi, getSettings });
  live.current = { bridge, notify, getApi, getSettings };

  const closeToken = useCallback(() => {
    const token = tokenRef.current;
    tokenRef.current = null;
    if (token !== null) {
      void live.current.bridge.close(token).catch(() => {});
    }
  }, []);

  const begin = useCallback(
    (info: PdfInfo) => {
      const api = live.current.getApi();
      if (!api) {
        void live.current.bridge.close(info.token).catch(() => {});
        return;
      }
      closeToken();
      tokenRef.current = info.token;
      setProgress(null);
      setSession({ info, api, settings: live.current.getSettings() });
    },
    [closeToken],
  );

  const open = useCallback(
    async (opener: () => Promise<PdfInfo | null>) => {
      if (!live.current.getApi()) {
        return;
      }
      try {
        const info = await opener();
        if (info) {
          begin(info);
        }
      } catch (err) {
        live.current.notify(pdfErrorMessage(err), "error");
      }
    },
    [begin],
  );

  const start = useCallback(
    () => open(() => live.current.bridge.pick()),
    [open],
  );
  const openFile = useCallback(
    (file: File) =>
      open(async () =>
        live.current.bridge.openBytes(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
        ),
      ),
    [open],
  );

  const cancel = useCallback(() => {
    if (abortRef.current) {
      // Running: the importer notices the signal, closes the token and throws.
      abortRef.current.abort();
      return;
    }
    closeToken();
    setSession(null);
  }, [closeToken]);

  const runImport = useCallback(
    async (indices: number[]) => {
      if (!session || abortRef.current) {
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress({ done: 0, total: indices.length });
      let handedOff = false;
      try {
        const { importPdf } = await import("./importPdf");
        handedOff = true;
        const result = await importPdf({
          api: session.api,
          bridge: live.current.bridge,
          info: session.info,
          indices,
          settings: session.settings,
          signal: controller.signal,
          onProgress: setProgress,
        });
        live.current.notify(importSummary(result, session.settings), "info");
      } catch (err) {
        if (!(err instanceof PdfImportAborted)) {
          live.current.notify(pdfErrorMessage(err), "error");
        }
      } finally {
        // importPdf closes the token itself; close it here only if it never ran.
        if (handedOff) {
          tokenRef.current = null;
        } else {
          closeToken();
        }
        abortRef.current = null;
        setProgress(null);
        setSession(null);
      }
    },
    [closeToken, session],
  );

  // Closing the app or switching vault mid-import must not leak the token.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      closeToken();
    },
    [closeToken],
  );

  const dialog = session ? (
    <Suspense fallback={null}>
      <PdfImportDialog
        info={session.info}
        settings={session.settings}
        api={session.api}
        progress={progress}
        onImport={(indices) => void runImport(indices)}
        onCancel={cancel}
      />
    </Suspense>
  ) : null;

  return { start, openFile, dialog };
};
