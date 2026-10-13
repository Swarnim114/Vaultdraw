import { isTauriAvailable } from "./DesktopVaultRepository";
import { MAX_ZOOM, MIN_ZOOM } from "./preferences";

export const DEFAULT_ZOOM = 100;
export const ZOOM_STEP = 10;

export type ZoomCommand = "in" | "out" | "reset";

export function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) {
    return DEFAULT_ZOOM;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(percent)));
}

export function stepZoom(current: number, direction: 1 | -1): number {
  return clampZoom(current + direction * ZOOM_STEP);
}

type ZoomKeyEvent = Pick<
  KeyboardEvent,
  "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

const COMMAND_BY_CODE: Record<string, ZoomCommand> = {
  Equal: "in",
  NumpadAdd: "in",
  Minus: "out",
  NumpadSubtract: "out",
  Digit0: "reset",
  Numpad0: "reset",
};

/** Cmd/Ctrl + Shift + (+ | - | 0). Plain Cmd +/-/0 stays with the canvas. */
export function zoomCommandForKey(
  e: ZoomKeyEvent,
  isMac: boolean,
): ZoomCommand | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || !e.shiftKey || e.altKey) {
    return null;
  }
  return COMMAND_BY_CODE[e.code] ?? null;
}

export interface WebviewZoomDeps {
  setZoom?: (scale: number) => Promise<void>;
}

async function nativeSetZoom(scale: number): Promise<void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().setZoom(scale);
}

let lastApplied = DEFAULT_ZOOM;
let queue: Promise<unknown> = Promise.resolve();

/** Test hook: forget the last applied value and pending calls. */
export function resetWebviewZoomState(): void {
  lastApplied = DEFAULT_ZOOM;
  queue = Promise.resolve();
}

/** Applies whole-webview zoom. Never throws; resolves true when applied. */
export function applyWebviewZoom(
  percent: number,
  deps: WebviewZoomDeps = {},
): Promise<boolean> {
  const target = clampZoom(percent);
  const run = async (): Promise<boolean> => {
    if (target === lastApplied) {
      return true;
    }
    const setZoom =
      deps.setZoom ?? (isTauriAvailable(window) ? nativeSetZoom : null);
    if (!setZoom) {
      return false;
    }
    try {
      await setZoom(target / 100);
      lastApplied = target;
      return true;
    } catch {
      return false;
    }
  };
  const result = queue.then(run, run);
  queue = result;
  return result;
}

export interface ZoomShortcutHandlers {
  onCommand(command: ZoomCommand): void;
}

/** One capture-phase listener on the window so the canvas never sees it. */
export function installZoomShortcuts(
  doc: Document,
  handlers: ZoomShortcutHandlers,
  isMac: boolean,
): () => void {
  const win = doc.defaultView;
  if (!win) {
    return () => {};
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const command = zoomCommandForKey(e, isMac);
    if (!command) {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    handlers.onCommand(command);
  };
  win.addEventListener("keydown", onKeyDown, true);
  return () => win.removeEventListener("keydown", onKeyDown, true);
}
