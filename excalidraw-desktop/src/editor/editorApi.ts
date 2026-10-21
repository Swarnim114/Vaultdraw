import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * documentId -> the editor's imperative API while that document's scene is the
 * one shown (history reads it lazily; nothing reads one document's scene
 * under another's id).
 */
const apis = new Map<string, ExcalidrawImperativeAPI>();

export const registerEditorApi = (
  documentId: string,
  api: ExcalidrawImperativeAPI,
): (() => void) => {
  apis.set(documentId, api);
  return () => {
    if (apis.get(documentId) === api) {
      apis.delete(documentId);
    }
  };
};

export const getEditorApi = (
  documentId: string,
): ExcalidrawImperativeAPI | undefined => apis.get(documentId);

/** Mounted editors, whichever document their scene belongs to right now. */
const live = new Set<ExcalidrawImperativeAPI>();

export const registerLiveEditor = (
  api: ExcalidrawImperativeAPI,
): (() => void) => {
  live.add(api);
  return () => {
    live.delete(api);
  };
};

/** Every mounted editor API (e2e harness hook: one entry per live editor, also while it swaps documents). */
export const allEditorApis = (): ExcalidrawImperativeAPI[] => [...live];
