/**
 * "Has the user panned yet?" detection for the canvas-panning hint under the
 * toolbar. The hint is hidden by CSS (`.vd-has-panned .HintViewer--canvas-panning`)
 * once the first pan happens; the flag is persisted as `hasPanned`.
 */

export interface PanProbe {
  type: "wheel" | "pointerdown";
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** Space is held (space-drag pans). */
  spaceHeld?: boolean;
  /** The active Excalidraw tool type. */
  tool?: string;
  /** The event target is the editor's canvas. */
  onCanvas: boolean;
}

/** A user gesture that moves the canvas (not a zoom, not a click in the UI). */
export const isPanGesture = (e: PanProbe): boolean => {
  if (!e.onCanvas) {
    return false;
  }
  if (e.type === "wheel") {
    return !e.ctrlKey && !e.metaKey; // ctrl/cmd + wheel (and pinch) zooms
  }
  return e.button === 1 || !!e.spaceHeld || e.tool === "hand";
};

export const PANNED_CLASS = "vd-has-panned";

const isEditable = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable === true)
  );
};

/**
 * Listens on `host` (capture) until the first pan, then removes every
 * listener and calls `onPanned` once.
 */
export const watchFirstPan = (
  host: HTMLElement,
  getTool: () => string | undefined,
  onPanned: () => void,
): (() => void) => {
  let spaceHeld = false;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space" && !isEditable(e.target)) {
      spaceHeld = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      spaceHeld = false;
    }
  };
  const probe = (e: WheelEvent | PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      isPanGesture({
        type: e.type === "wheel" ? "wheel" : "pointerdown",
        button: (e as PointerEvent).button,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        spaceHeld,
        tool: getTool(),
        onCanvas: target?.tagName === "CANVAS",
      })
    ) {
      stop();
      onPanned();
    }
  };
  const stop = () => {
    host.removeEventListener("wheel", probe, true);
    host.removeEventListener("pointerdown", probe, true);
    host.removeEventListener("keydown", onKeyDown, true);
    host.removeEventListener("keyup", onKeyUp, true);
  };
  host.addEventListener("wheel", probe, { capture: true, passive: true });
  host.addEventListener("pointerdown", probe, true);
  host.addEventListener("keydown", onKeyDown, true);
  host.addEventListener("keyup", onKeyUp, true);
  return stop;
};
