/**
 * Release builds must not show WKWebView's native context menu: its
 * background menu offers "Reload" (and Back/Forward, Inspect Element). A
 * reload restarts the frontend inside the same process (toimprove #39).
 *
 * One document-level listener, registered once at startup, in the bubble
 * phase on the window. The app's own menus (the Excalidraw canvas menu, the
 * navigator rows, the tab strip, ...) are React handlers: React 17+ attaches
 * them to the root container, which sits below the window, so they run first
 * and call preventDefault; this listener then sees `defaultPrevented` and
 * leaves the event alone. It never stops propagation.
 *
 * Still allowed (native menu kept):
 * - editable targets (input, textarea, select, contenteditable, including the
 *   Excalidraw text editor textarea): Cut/Copy/Paste and spellcheck;
 * - a right-click on a non-empty text selection: WebKit then shows the
 *   selection menu (Copy, Look Up, Translate, Search), which has no Reload
 *   item. A right-click elsewhere collapses the selection first, so the
 *   background menu with Reload stays suppressed.
 * Dev builds keep the native menu (Inspect Element).
 */

export type ContextMenuDecisionInput = {
  enabled: boolean;
  defaultPrevented: boolean;
  /** The target is an input, textarea, select or contenteditable region. */
  editable: boolean;
  /** The target lies inside a non-empty text selection. */
  onSelection: boolean;
};

/** True when the native menu must be suppressed. */
export const shouldSuppressNativeMenu = (
  input: ContextMenuDecisionInput,
): boolean =>
  input.enabled &&
  !input.defaultPrevented &&
  !input.editable &&
  !input.onSelection;

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

export const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target as Element | null;
  if (!element || typeof element.closest !== "function") {
    return false;
  }
  return (
    (element as HTMLElement).isContentEditable === true ||
    element.closest(EDITABLE_SELECTOR) !== null
  );
};

const isOnSelection = (win: Window, target: EventTarget | null): boolean => {
  const selection = win.getSelection?.();
  if (!selection || selection.isCollapsed || !target) {
    return false;
  }
  return selection.containsNode?.(target as Node, true) ?? false;
};

/**
 * Registers the listener. `enabled` defaults to release builds; tests pass
 * it explicitly. Returns an uninstall function.
 */
export const installNativeContextMenuSuppression = (
  win: Window,
  enabled: boolean = import.meta.env.PROD,
): (() => void) => {
  if (!enabled) {
    return () => {};
  }
  const onContextMenu = (event: MouseEvent) => {
    if (
      shouldSuppressNativeMenu({
        enabled,
        defaultPrevented: event.defaultPrevented,
        editable: isEditableTarget(event.target),
        onSelection: isOnSelection(win, event.target),
      })
    ) {
      event.preventDefault();
    }
  };
  win.addEventListener("contextmenu", onContextMenu);
  return () => win.removeEventListener("contextmenu", onContextMenu);
};
