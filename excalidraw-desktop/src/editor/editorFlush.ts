export type FlushOptions = {
  /**
   * Blur the WYSIWYG text editor so Excalidraw commits it. Only needed right
   * before the editor unmounts (switch, reload, close); the live scene already
   * contains in-progress text, so routine saves must not interrupt typing.
   */
  commitText?: boolean;
};

type FlushPendingSerialization = (options?: FlushOptions) => void;

const flushers = new Map<string, FlushPendingSerialization>();

/** Register the editor's synchronous serialization barrier for a document. */
export const registerEditorFlush = (
  documentId: string,
  flush: FlushPendingSerialization,
): (() => void) => {
  flushers.set(documentId, flush);
  return () => {
    if (flushers.get(documentId) === flush) {
      flushers.delete(documentId);
    }
  };
};

/** Serialize any delayed editor change before a document transition/check. */
export const flushEditorSerialization = (
  documentId: string,
  options: FlushOptions = { commitText: false },
): void => {
  flushers.get(documentId)?.(options);
};
