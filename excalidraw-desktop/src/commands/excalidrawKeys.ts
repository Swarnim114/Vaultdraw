/**
 * Excalidraw's own keyboard shortcuts in our chord notation, used to warn when
 * a command takes a key the canvas already uses.
 *
 * Hand-maintained but verified: excalidrawKeys.test.ts re-reads
 * packages/excalidraw (actions/shortcuts.ts `shortcutMap` and the TOOLS table
 * in components/Tools.tsx) and fails when upstream adds or changes a key.
 * `source` says which entries that test covers: "shortcutMap" and "tool" are
 * checked against the sources, "other" entries (keyTest-only actions and
 * built-in behaviour) are maintained by hand.
 */
import { normalizeChord } from "./keys";

import type { Chord, Platform } from "./types";

export type ExcalidrawKeySource = "shortcutMap" | "tool" | "other";

export interface ExcalidrawKey {
  chord: Chord;
  /** Only these platforms (default: all). */
  platforms?: Platform[];
  /** Stable action name: shortcutMap key, "tool.<name>" or a descriptive id. */
  action: string;
  /** Human label shown next to a conflict. */
  label: string;
  source: ExcalidrawKeySource;
}

const NOT_MAC: Platform[] = ["win", "linux"];

const entries = (
  source: ExcalidrawKeySource,
  action: string,
  label: string,
  chords: readonly Chord[],
  platforms?: Platform[],
): ExcalidrawKey[] =>
  chords.map((chord) => ({ chord, action, label, source, platforms }));

const shortcut = (
  action: string,
  label: string,
  ...chords: Chord[]
): ExcalidrawKey[] => entries("shortcutMap", action, label, chords);

const tool = (name: string, label: string, ...chords: Chord[]) =>
  entries("tool", `tool.${name}`, label, chords);

const other = (action: string, label: string, ...chords: Chord[]) =>
  entries("other", action, label, chords);

export const EXCALIDRAW_KEYS: readonly ExcalidrawKey[] = [
  // packages/excalidraw/actions/shortcuts.ts `shortcutMap`
  ...shortcut("toggleTheme", "Toggle theme", "Alt+Shift+D"),
  ...shortcut("saveScene", "Save", "Mod+S"),
  ...shortcut("loadScene", "Open", "Mod+O"),
  ...shortcut("clearCanvas", "Clear canvas", "Mod+Delete"),
  ...shortcut("imageExport", "Export image", "Mod+Shift+E"),
  ...shortcut("commandPalette", "Command palette", "Mod+Slash", "Mod+Shift+P"),
  ...shortcut("cut", "Cut", "Mod+X"),
  ...shortcut("copy", "Copy", "Mod+C"),
  ...shortcut("paste", "Paste", "Mod+V"),
  ...shortcut("copyStyles", "Copy styles", "Mod+Alt+C"),
  ...shortcut("pasteStyles", "Paste styles", "Mod+Alt+V"),
  ...shortcut("selectAll", "Select all", "Mod+A"),
  ...shortcut("deleteSelectedElements", "Delete selection", "Delete"),
  ...shortcut("duplicateSelection", "Duplicate selection", "Mod+D"),
  ...shortcut("sendBackward", "Send backward", "Mod+BracketLeft"),
  ...shortcut("bringForward", "Bring forward", "Mod+BracketRight"),
  ...entries(
    "shortcutMap",
    "sendToBack",
    "Send to back",
    ["Mod+Alt+BracketLeft"],
    ["mac"],
  ),
  ...entries(
    "shortcutMap",
    "sendToBack",
    "Send to back",
    ["Mod+Shift+BracketLeft"],
    NOT_MAC,
  ),
  ...entries(
    "shortcutMap",
    "bringToFront",
    "Bring to front",
    ["Mod+Alt+BracketRight"],
    ["mac"],
  ),
  ...entries(
    "shortcutMap",
    "bringToFront",
    "Bring to front",
    ["Mod+Shift+BracketRight"],
    NOT_MAC,
  ),
  ...shortcut("copyAsPng", "Copy as PNG", "Alt+Shift+C"),
  ...shortcut("group", "Group", "Mod+G"),
  ...shortcut("ungroup", "Ungroup", "Mod+Shift+G"),
  ...shortcut("gridMode", "Toggle grid", "Mod+Quote"),
  ...shortcut("zenMode", "Zen mode", "Alt+Z"),
  ...shortcut("objectsSnapMode", "Snap to objects", "Alt+S"),
  ...shortcut("stats", "Stats", "Alt+Slash"),
  ...shortcut("flipHorizontal", "Flip horizontal", "Shift+H"),
  ...shortcut("flipVertical", "Flip vertical", "Shift+V"),
  ...shortcut("viewMode", "View mode", "Alt+R"),
  ...shortcut("hyperlink", "Link", "Mod+K"),
  ...shortcut("toggleElementLock", "Lock element", "Mod+Shift+L"),
  ...shortcut("resetZoom", "Reset canvas zoom", "Mod+0"),
  ...shortcut("zoomOut", "Canvas zoom out", "Mod+Minus"),
  ...shortcut("zoomIn", "Canvas zoom in", "Mod+Equal"),
  ...shortcut("zoomToFitSelection", "Zoom to selection", "Shift+3"),
  ...shortcut("zoomToFit", "Zoom to fit", "Shift+1"),
  ...shortcut(
    "zoomToFitSelectionInViewport",
    "Zoom to fit selection",
    "Shift+2",
  ),
  ...shortcut("saveFileToDisk", "Save", "Mod+S"),
  ...shortcut("saveToActiveFile", "Save", "Mod+S"),
  ...shortcut("toggleShortcuts", "Keyboard shortcuts", "Shift+Slash"),
  ...shortcut("searchMenu", "Find on canvas", "Mod+F"),
  ...shortcut("toolLock", "Keep tool active", "Q"),

  // packages/excalidraw/components/Tools.tsx `TOOLS`
  ...tool("hand", "Hand tool", "H"),
  ...tool("selection", "Selection tool", "V", "1"),
  ...tool("rectangle", "Rectangle tool", "R", "2"),
  ...tool("diamond", "Diamond tool", "D", "3"),
  ...tool("ellipse", "Ellipse tool", "O", "4"),
  ...tool("arrow", "Arrow tool", "A", "5"),
  ...tool("line", "Line tool", "L", "6"),
  ...tool("freedraw", "Draw tool", "P", "X", "7"),
  ...tool("text", "Text tool", "T", "8"),
  ...tool("stickynote", "Sticky note tool", "N"),
  ...tool("image", "Image tool", "9"),
  ...tool("eraser", "Eraser tool", "E", "0"),
  ...tool("frame", "Frame tool", "F"),
  ...tool("autoshape", "Shape recognition tool", "Shift+X"),
  ...tool("laser", "Laser pointer tool", "K"),
  ...tool("bucketfill", "Bucket fill tool", "B"),

  // keyTest-only actions and built-in behaviour (hand-maintained)
  ...other("quickSwitcherHint", "Command palette hint", "Mod+P"),
  ...other("undo", "Undo", "Mod+Z"),
  ...other("redo", "Redo", "Mod+Shift+Z", "Mod+Y"),
  ...other("pastePlainText", "Paste as plain text", "Mod+Shift+V"),
  ...other(
    "canvasZoomNumpad",
    "Canvas zoom",
    "Mod+NumpadAdd",
    "Mod+NumpadSubtract",
    "Mod+Numpad0",
  ),
  ...other("decreaseFontSize", "Decrease font size", "Mod+Shift+Comma"),
  ...other("increaseFontSize", "Increase font size", "Mod+Shift+Period"),
  ...other("alignTop", "Align top", "Mod+Shift+ArrowUp"),
  ...other("alignBottom", "Align bottom", "Mod+Shift+ArrowDown"),
  ...other("alignLeft", "Align left", "Mod+Shift+ArrowLeft"),
  ...other("alignRight", "Align right", "Mod+Shift+ArrowRight"),
  ...other("distributeHorizontally", "Distribute horizontally", "Alt+H"),
  ...other("distributeVertically", "Distribute vertically", "Alt+V"),
  ...other("deleteElements", "Delete selection", "Backspace"),
  ...other(
    "nudge",
    "Move selection",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ),
  ...other("cancelOrFinish", "Cancel or finish", "Escape", "Enter"),
  ...other("cycleSelection", "Cycle selection", "Tab", "Shift+Tab"),
  ...other("panCanvas", "Pan canvas (hold)", "Space"),
  ...other("scrollPage", "Scroll canvas", "PageUp", "PageDown"),
];

const byChord = new Map<Chord, ExcalidrawKey[]>();
for (const key of EXCALIDRAW_KEYS) {
  const list = byChord.get(key.chord);
  if (list) {
    list.push(key);
  } else {
    byChord.set(key.chord, [key]);
  }
}

/**
 * Excalidraw actions bound to `chord` on `platform` (one per label).
 * `chord` may use Meta/Ctrl: it is normalised first.
 */
export function excalidrawActionsFor(
  chord: Chord,
  platform: Platform,
): readonly ExcalidrawKey[] {
  const hits = byChord.get(normalizeChord(chord, platform));
  if (!hits) {
    return [];
  }
  const seen = new Set<string>();
  return hits.filter((key) => {
    if (key.platforms && !key.platforms.includes(platform)) {
      return false;
    }
    if (seen.has(key.label)) {
      return false;
    }
    seen.add(key.label);
    return true;
  });
}
