import { useState, useRef, useEffect, useCallback } from "react";

import { EDITOR_LS_KEYS, debounce, isDevEnv } from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { useApp } from "../App";
import { ArrowRightIcon } from "../icons";
import { EditorLocalStorage } from "../../data/EditorLocalStorage";
import { t } from "../../i18n";
import Trans from "../Trans";

import { useUIAppState } from "../../context/ui-appState";

import { TTDDialogInput } from "./TTDDialogInput";
import { TTDDialogOutput } from "./TTDDialogOutput";
import { TTDDialogPanel } from "./TTDDialogPanel";
import { TTDDialogPanels } from "./TTDDialogPanels";
import { TTDDialogSubmitShortcut } from "./TTDDialogSubmitShortcut";
import {
  getMermaidErrorLineNumber,
  isMermaidAutoFixableError,
} from "./utils/mermaidError";
import { getMermaidAutoFixCandidates } from "./utils/mermaidAutoFix";
import {
  convertMermaidToExcalidraw,
  insertToEditor,
  saveMermaidDataToStorage,
  resetPreview,
} from "./common";

import "./MermaidToExcalidraw.scss";

import type { BinaryFiles } from "../../types";
import type { MermaidToExcalidrawLibProps } from "./types";

const MERMAID_EXAMPLE =
  "flowchart TD\n A[Christmas] -->|Get money| B(Go shopping)\n B --> C{Let me think}\n C -->|One| D[Laptop]\n C -->|Two| E[iPhone]\n C -->|Three| F[Car]";

const debouncedSaveMermaidDefinition = debounce(saveMermaidDataToStorage, 300);
export const PREVIEW_DEBOUNCE_MS = 300;
// auto-fix may run many full parses on the main thread, so skip big inputs
export const AUTO_FIX_MAX_INPUT_LENGTH = 5000;
const AUTO_FIX_DEBOUNCE_MS = 500;
const AUTO_FIX_MAX_DEPTH = 4;
const AUTO_FIX_MAX_CANDIDATES = 30;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
};

const MermaidToExcalidraw = ({
  mermaidToExcalidrawLib,
  isActive,
}: {
  mermaidToExcalidrawLib: MermaidToExcalidrawLibProps;
  isActive?: boolean;
}) => {
  const [text, setText] = useState(
    () =>
      EditorLocalStorage.get<string>(EDITOR_LS_KEYS.MERMAID_TO_EXCALIDRAW) ||
      MERMAID_EXAMPLE,
  );
  // text the preview is (being) rendered for; trails `text` by the debounce
  const [previewText, setPreviewText] = useState(text);
  const [error, setError] = useState<Error | null>(null);
  const [autoFixCandidate, setAutoFixCandidate] = useState<string | null>(null);

  const errorLine = (() => {
    if (!error?.message) {
      return null;
    }
    return getMermaidErrorLineNumber(error.message, previewText);
  })();

  const canvasRef = useRef<HTMLDivElement>(null);
  const data = useRef<{
    elements: readonly NonDeletedExcalidrawElement[];
    files: BinaryFiles | null;
  }>({ elements: [], files: null });

  const app = useApp();
  const { theme } = useUIAppState();

  const requestIdRef = useRef(0);
  // the definition whose elements are currently held in `data`
  const convertedTextRef = useRef<string | null>(null);

  // only the latest request may update preview/error/data
  const render = useCallback(
    async (definition: string): Promise<boolean> => {
      const requestId = ++requestIdRef.current;
      const isStale = () => requestId !== requestIdRef.current;
      try {
        if (!definition.trim()) {
          convertedTextRef.current = null;
          resetPreview({ canvasRef, setError });
          return false;
        }
        const result = await convertMermaidToExcalidraw({
          canvasRef,
          data,
          mermaidToExcalidrawLib,
          setError,
          mermaidDefinition: definition,
          theme,
          isStale,
        });

        if (isStale()) {
          return false;
        }
        if (!result.success) {
          convertedTextRef.current = null;
          // no error means nothing to report (preview canvas not mounted yet
          // while the library loads, or an empty definition)
          if (result.error) {
            setError(result.error);
          }
          return false;
        }
        convertedTextRef.current = definition;
        return true;
      } catch (err) {
        if (isDevEnv()) {
          console.error("Failed to parse mermaid definition", err);
        }
        return false;
      }
    },
    [mermaidToExcalidrawLib, theme],
  );

  // debounce typing; first open / tab activation render immediately because
  // previewText starts equal to text
  useEffect(() => {
    if (!isActive || text === previewText) {
      return;
    }
    const timer = setTimeout(() => setPreviewText(text), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, previewText, isActive]);

  useEffect(() => {
    if (isActive) {
      render(previewText);
    }
  }, [previewText, render, isActive]);

  // save the raw text (not the debounced preview text) so closing right after
  // typing never loses it; flushed on unmount below
  useEffect(() => {
    if (isActive) {
      debouncedSaveMermaidDefinition(text);
    }
  }, [text, isActive]);

  useEffect(
    () => () => {
      debouncedSaveMermaidDefinition.flush();
    },
    [],
  );

  useEffect(() => {
    const errorMessage = error?.message ?? "";
    const sourceText = previewText;
    const shouldTryAutoFix =
      isActive &&
      isMermaidAutoFixableError(errorMessage) &&
      !!sourceText.trim() &&
      sourceText.length <= AUTO_FIX_MAX_INPUT_LENGTH &&
      mermaidToExcalidrawLib.loaded;

    if (!shouldTryAutoFix) {
      setAutoFixCandidate(null);
      return;
    }

    const candidates = getMermaidAutoFixCandidates(sourceText, errorMessage);
    if (!candidates.length) {
      setAutoFixCandidate(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const api = await mermaidToExcalidrawLib.api;
        const seen = new Set<string>([sourceText]);
        const queue = candidates.map((candidate) => ({
          text: candidate,
          depth: 1,
        }));

        let triedCandidates = 0;

        while (queue.length > 0 && triedCandidates < AUTO_FIX_MAX_CANDIDATES) {
          if (cancelled) {
            return;
          }
          const current = queue.shift();
          if (!current || seen.has(current.text)) {
            continue;
          }
          seen.add(current.text);
          triedCandidates += 1;

          try {
            await api.parseMermaidToExcalidraw(current.text);
            if (!cancelled) {
              setAutoFixCandidate(current.text);
            }
            return;
          } catch (candidateError) {
            if (current.depth >= AUTO_FIX_MAX_DEPTH) {
              continue;
            }
            const nextErrorMessage = getErrorMessage(candidateError);
            if (!nextErrorMessage) {
              continue;
            }
            const nextCandidates = getMermaidAutoFixCandidates(
              current.text,
              nextErrorMessage,
            );
            for (const nextCandidate of nextCandidates) {
              if (!seen.has(nextCandidate)) {
                queue.push({
                  text: nextCandidate,
                  depth: current.depth + 1,
                });
              }
            }
          }
        }
      } catch {
        // ignore auto-fix probe errors
      }
      if (!cancelled) {
        setAutoFixCandidate(null);
      }
    }, AUTO_FIX_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewText, error?.message, isActive, mermaidToExcalidrawLib]);

  const onInsertToEditor = async () => {
    // a debounced or in-flight conversion may not reflect the latest text yet
    if (convertedTextRef.current !== text && !(await render(text))) {
      return;
    }
    insertToEditor({
      app,
      data,
      text,
      shouldSaveMermaidDataToStorage: true,
    });
  };

  const onApplyAutoFix = () => {
    if (!autoFixCandidate) {
      return;
    }
    setText(autoFixCandidate);
  };

  return (
    <>
      <div className="ttd-dialog-desc">
        <Trans
          i18nKey="mermaid.description"
          flowchartLink={(el) => (
            <a
              href="https://mermaid.js.org/syntax/flowchart.html"
              target="_blank"
              rel="noreferrer"
            >
              {el}
            </a>
          )}
          sequenceLink={(el) => (
            <a
              href="https://mermaid.js.org/syntax/sequenceDiagram.html"
              target="_blank"
              rel="noreferrer"
            >
              {el}
            </a>
          )}
          classLink={(el) => (
            <a
              href="https://mermaid.js.org/syntax/classDiagram.html"
              target="_blank"
              rel="noreferrer"
            >
              {el}
            </a>
          )}
          erdLink={(el) => (
            <a
              href="https://mermaid.js.org/syntax/entityRelationshipDiagram.html"
              target="_blank"
              rel="noreferrer"
            >
              {el}
            </a>
          )}
        />
      </div>
      <TTDDialogPanels>
        <TTDDialogPanel>
          <TTDDialogInput
            input={text}
            placeholder={t("mermaid.inputPlaceholder")}
            onChange={(value) => setText(value)}
            errorLine={errorLine}
            onKeyboardSubmit={() => {
              onInsertToEditor();
            }}
          />
        </TTDDialogPanel>
        <TTDDialogPanel
          panelActions={[
            {
              action: () => {
                onInsertToEditor();
              },
              label: t("mermaid.button"),
              icon: ArrowRightIcon,
              variant: "button",
            },
          ]}
          renderSubmitShortcut={() => <TTDDialogSubmitShortcut />}
        >
          <TTDDialogOutput
            canvasRef={canvasRef}
            loaded={mermaidToExcalidrawLib.loaded}
            error={error}
            sourceText={text}
            autoFixAvailable={!!autoFixCandidate}
            onApplyAutoFix={onApplyAutoFix}
          />
        </TTDDialogPanel>
      </TTDDialogPanels>
    </>
  );
};
export default MermaidToExcalidraw;
