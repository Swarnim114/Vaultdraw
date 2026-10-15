/**
 * "Insert link...": put `[[target]]` at the caret when a text element is being
 * edited, otherwise create a text element holding it in the middle of the view.
 * The caret is captured before the palette opens (which blurs the editor).
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { applyEdits } from "./applyEdits";

export type CaretCapture = {
  elementId: string;
  start: number;
  end: number;
  textarea: HTMLTextAreaElement | null;
};

export function captureCaret(
  api: ExcalidrawImperativeAPI,
  container: HTMLElement | null,
): CaretCapture | null {
  const editing = api.getAppState().editingTextElement;
  if (!editing) {
    return null;
  }
  const textarea = container?.querySelector<HTMLTextAreaElement>(
    "textarea.excalidraw-wysiwyg",
  );
  return {
    elementId: editing.id,
    start: textarea?.selectionStart ?? editing.originalText.length,
    end: textarea?.selectionEnd ?? editing.originalText.length,
    textarea: textarea ?? null,
  };
}

/** Returns true when the link was written. */
export function insertLinkText(
  api: ExcalidrawImperativeAPI,
  caret: CaretCapture | null,
  link: string,
): boolean {
  if (caret) {
    const { textarea } = caret;
    if (textarea?.isConnected) {
      textarea.focus();
      textarea.setRangeText(link, caret.start, caret.end, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    const el = api
      .getSceneElements()
      .find((e) => e.id === caret.elementId && e.type === "text") as
      | { originalText: string }
      | undefined;
    if (el) {
      const text = el.originalText;
      const start = Math.min(caret.start, text.length);
      const end = Math.min(Math.max(caret.end, start), text.length);
      return (
        applyEdits(api, [
          {
            elementId: caret.elementId,
            field: "text",
            value: text.slice(0, start) + link + text.slice(end),
          },
        ]) > 0
      );
    }
  }
  const app = api.getAppState();
  const zoom = app.zoom.value;
  const created = convertToExcalidrawElements([
    {
      type: "text",
      x: app.width / 2 / zoom - app.scrollX,
      y: app.height / 2 / zoom - app.scrollY,
      text: link,
      fontSize: app.currentItemFontSize,
      fontFamily: app.currentItemFontFamily,
      strokeColor: app.currentItemStrokeColor,
    },
  ]);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    captureUpdate: "IMMEDIATELY" as never,
  });
  return created.length > 0;
}
