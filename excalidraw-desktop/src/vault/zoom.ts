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

/** The zoom after applying a command to the current percentage. */
export function nextZoom(current: number, command: ZoomCommand): number {
  if (command === "reset") {
    return DEFAULT_ZOOM;
  }
  return stepZoom(current, command === "in" ? 1 : -1);
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
