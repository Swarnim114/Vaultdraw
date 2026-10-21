/**
 * Blocks user input to the editor while its scene is being replaced. The old
 * scene stays on screen (and fully styled) until the new one is ready, so the
 * guard is invisible: pointer events are dropped by CSS (`data-swapping`),
 * `inert` keeps focus out, and keyboard/clipboard events aimed at the canvas
 * (the editor listens on the document) are stopped before it sees them.
 */
const GUARDED_EVENTS = ["keydown", "paste", "cut", "copy"] as const;

export const SWAPPING_ATTR = "data-swapping";

export const blockEditorInput = (host: HTMLElement): (() => void) => {
  const win = host.ownerDocument.defaultView;
  host.setAttribute(SWAPPING_ATTR, "true");
  host.setAttribute("inert", "");
  const stop = (event: Event) => {
    const target = event.target as Node | null;
    const doc = host.ownerDocument;
    // Typing into other UI (navigator search, palette) is not ours to block.
    if (
      !target ||
      target === doc.body ||
      target === doc.documentElement ||
      host.contains(target)
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  };
  for (const type of GUARDED_EVENTS) {
    win?.addEventListener(type, stop, true);
  }
  return () => {
    for (const type of GUARDED_EVENTS) {
      win?.removeEventListener(type, stop, true);
    }
    host.removeAttribute(SWAPPING_ATTR);
    host.removeAttribute("inert");
  };
};
