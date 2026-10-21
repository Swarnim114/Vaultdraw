import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/** documentId -> the mounted editor's imperative API (history reads it lazily). */
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

/** Every mounted editor API (e2e harness hook: one entry per live editor). */
export const allEditorApis = (): ExcalidrawImperativeAPI[] => [
  ...apis.values(),
];
