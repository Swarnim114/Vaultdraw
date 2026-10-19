// Exposes the thumbnail renderer to e2e/thumbnailsPerf.spec.ts (built on its own,
// so the harness entry (harnessMain.tsx) stays untouched).
import { THUMB_MAX_ELEMENTS, renderScenePng } from "../src/thumbnails/render";

export interface Step0Hooks {
  renderScenePng: typeof renderScenePng;
  maxElements: number;
}

(window as unknown as { __step0: Step0Hooks }).__step0 = {
  renderScenePng,
  maxElements: THUMB_MAX_ELEMENTS,
};
