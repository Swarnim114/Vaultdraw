/**
 * Opt-in memory ablation probe (perf/run.mjs --ablate). With the 300-element
 * drawing open, hides or releases one UI part at a time, lets WebKit settle,
 * then emits a `phase:abl-<name>` mark: the harness samples per-process
 * footprint at that mark (WebContent graphics = IOSurface backing stores, GPU
 * process), so the drop between consecutive samples is that part's share.
 * Each step restores what it changed before the next baseline.
 */
import {
  clearElementCanvasCache,
  elementWithCanvasCache,
} from "@excalidraw/element";

import type { PerfKit } from "./perfKit";

const SETTLE_MS = 5000;
/** Time the app stays put after the mark so the harness can finish sampling. */
const SAMPLE_HOLD_MS = 4000;
const MB = 1024 * 1024;
const round = (n: number) => Math.round(n * 10) / 10;

export async function runAblation(kit: PerfKit): Promise<void> {
  const { doc, info, sleep, raf, scenario } = kit;
  let baselines = 0;

  /** Canvases and images document-wide, the element bitmap cache, and the window geometry. */
  const counters = (name: string) => {
    const canvases = Array.from(doc.querySelectorAll("canvas"));
    const images = Array.from(doc.querySelectorAll("img"));
    const prefix = `abl.${name}`;
    info[`${prefix}.canvases`] = canvases.length;
    info[`${prefix}.canvasMB`] = round(
      canvases.reduce((sum, c) => sum + c.width * c.height * 4, 0) / MB,
    );
    info[`${prefix}.images`] = images.length;
    info[`${prefix}.imageMB`] = round(
      images.reduce((sum, i) => sum + i.naturalWidth * i.naturalHeight * 4, 0) /
        MB,
    );
    info[`${prefix}.bitmapCacheEntries`] = elementWithCanvasCache.size;
    info[`${prefix}.bitmapCacheMB`] = round(elementWithCanvasCache.bytes / MB);
    info[`${prefix}.dpr`] = window.devicePixelRatio;
    info[`${prefix}.window`] = `${window.innerWidth}x${window.innerHeight}`;
  };

  /** Settle, mark (harness samples), keep still while it samples. */
  const sample = async (name: string) => {
    // A hidden root may stop rAF in WKWebView: never wait more than 500 ms for frames.
    await Promise.race([raf().then(raf), sleep(500)]);
    await sleep(SETTLE_MS);
    await scenario(`abl-${name}`, async () => {
      counters(name);
      await sleep(SAMPLE_HOLD_MS);
    });
  };

  const baseline = () => sample(`baseline-${++baselines}`);

  const step = async (
    name: string,
    apply: () => void | Promise<void>,
    restore: () => void | Promise<void> = () => {},
  ) => {
    await apply();
    await sample(name);
    await restore();
    await baseline();
  };

  /** display:none on every match of a selector; restore puts the old values back. */
  const hide = (selector: string) => {
    const els = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    if (!els.length) {
      info[`abl.missing.${selector}`] = true;
    }
    const previous = els.map((el) => el.style.display);
    return {
      apply: () => els.forEach((el) => (el.style.display = "none")),
      restore: () => els.forEach((el, i) => (el.style.display = previous[i])),
    };
  };
  const hideStep = (name: string, selector: string) => {
    const { apply, restore } = hide(selector);
    return step(name, apply, restore);
  };

  /** A tiny pan so the static canvas re-renders (and refills the bitmap cache). */
  const nudge = async () => {
    const canvas = kit.interactiveCanvas();
    if (canvas) {
      await kit.wheelPass(canvas, 300, (phase) => ({
        deltaX: 0,
        deltaY: phase === 0 ? 40 : -40,
        shiftKey: true,
      }));
    }
  };

  await baseline();
  await hideStep("interactive-canvas", ".excalidraw__canvas.interactive");
  await hideStep("static-canvas", ".excalidraw__canvas.static");
  await hideStep(
    "new-element-canvas",
    "canvas.excalidraw__canvas:not(.static):not(.interactive)",
  );
  await hideStep("navigator", ".vault-navigator");
  await hideStep("excalidraw-ui", ".layer-ui__wrapper");
  await hideStep("header", ".vault-header");

  // Bitmap cache: released but not repainted, then refilled by a re-render.
  await step("cache-cleared", clearElementCanvasCache);
  await nudge();
  await sample("cache-refilled");
  await baseline();

  await hideStep("excalidraw-container", ".vault-editor .excalidraw-container");
  await hideStep("vault-app", ".vault-app");
}
