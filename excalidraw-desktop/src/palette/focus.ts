/** Where focus goes after the palette closes. */

/** Excalidraw's focusable container (tabIndex=0) inside the vault editor. */
const CANVAS_SELECTOR = ".vault-editor .excalidraw-container";

/**
 * Give the canvas keyboard focus unless something else already took it (a
 * dialog, the navigator search, a text field a command focused).
 */
export function focusCanvasIfIdle(doc: Document | null | undefined): void {
  if (!doc) {
    return;
  }
  const active = doc.activeElement;
  if (active && active !== doc.body && active.isConnected) {
    return;
  }
  doc.querySelector<HTMLElement>(CANVAS_SELECTOR)?.focus({
    preventScroll: true,
  });
}
