/** Context facts the dispatcher checks a command's `when` against. */
import type { CommandContext, WhenClause } from "./types";

export interface AppContext {
  vaultOpen: boolean;
  drawingOpen: boolean;
  writable: boolean;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "submit",
  "reset",
]);

/** Input, textarea, select, contenteditable (incl. Excalidraw's WYSIWYG). */
export function isTextEditingTarget(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (tag === "INPUT") {
    return !NON_TEXT_INPUT_TYPES.has(
      ((el as HTMLInputElement).type || "text").toLowerCase(),
    );
  }
  if (el.classList.contains("excalidraw-wysiwyg")) {
    return true;
  }
  const editable = el.closest("[contenteditable]");
  return !!editable && editable.getAttribute("contenteditable") !== "false";
}

/**
 * Commit an in-progress Excalidraw text edit before a command moves focus
 * (save, quick switcher, navigator search; Settings deliberately keeps it).
 * Excalidraw's WYSIWYG submits on blur and then refocuses its canvas
 * container; blurring first makes that happen now, instead of stealing focus
 * back from what the command focuses.
 */
export function commitCanvasTextEdit(doc: Document | null | undefined): void {
  const active = doc?.activeElement;
  if (active?.classList.contains("excalidraw-wysiwyg")) {
    (active as HTMLElement).blur();
  }
}

export function readContext(doc: Document, app: AppContext): CommandContext {
  const active = doc.activeElement;
  const textEditing = isTextEditingTarget(active);
  return {
    vaultOpen: app.vaultOpen,
    drawingOpen: app.drawingOpen,
    writable: app.writable,
    textEditing,
    canvasFocus: !textEditing && !!active?.closest(".vault-editor"),
    modalOpen: !!doc.querySelector(".vault-modal-backdrop"),
  };
}

export function whenHolds(
  when: readonly WhenClause[] | undefined,
  ctx: CommandContext,
): boolean {
  if (!when) {
    return true;
  }
  for (const clause of when) {
    if (clause.charCodeAt(0) === 33 /* ! */) {
      if (ctx[clause.slice(1) as keyof CommandContext]) {
        return false;
      }
    } else if (!ctx[clause as keyof CommandContext]) {
      return false;
    }
  }
  return true;
}
