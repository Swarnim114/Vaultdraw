import { useEffect } from "react";

import { cancelIdleBackingStore } from "./idleBackingStore";

/**
 * Frees a canvas' backing store when its editor unmounts. WebKit keeps the
 * pixels of a detached canvas until GC runs (hundreds of MB after a few
 * drawing switches), but drops them as soon as the canvas is resized to 0x0.
 *
 * The same effect restores the size, because React StrictMode re-runs effects
 * (cleanup, then setup) on the same DOM node and React does not re-apply the
 * `width`/`height` attributes it already set.
 */
export const useCanvasBackingStore = (
  getCanvas: () => HTMLCanvasElement | null,
  width: number,
  height: number,
) => {
  useEffect(() => {
    const canvas = getCanvas();
    if (!canvas) {
      return;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return () => {
      cancelIdleBackingStore(canvas);
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [getCanvas, width, height]);
};
