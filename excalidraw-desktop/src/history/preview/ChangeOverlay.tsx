/**
 * Highlights over the history preview: one pointer-transparent <canvas>
 * drawn on the preview's viewport changes (rAF-throttled). Solid outlines for
 * elements only in the version and for changed ones, dashed ghost outlines
 * for current elements the version does not have. Nothing is mounted while
 * highlights are off, so there is no listener and no canvas then.
 */
import { useEffect, useRef } from "react";

import { getElementBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./changeOverlay.css";

import type { SceneDiff } from "../diff";

export const HIGHLIGHT_COLORS = {
  added: "#2f9e44",
  changed: "#f08c00",
  removed: "#e03131",
} as const;

export interface ChangeOverlayProps {
  /** The preview editor; the overlay waits for it. */
  api: ExcalidrawImperativeAPI | null;
  diff: SceneDiff;
  /** The version's elements (bounds of added and changed ones). */
  versionElements: readonly ExcalidrawElement[];
}

type Box = [number, number, number, number];
type ElementMap = Map<string, ExcalidrawElement>;

const toMap = (list: readonly ExcalidrawElement[]): ElementMap =>
  new Map(list.map((el) => [el.id, el]));

const boundsOf = (ids: readonly string[], map: ElementMap): Box[] => {
  const out: Box[] = [];
  for (const id of ids) {
    const el = map.get(id);
    if (el) {
      out.push(getElementBounds(el, map as never) as unknown as Box);
    }
  }
  return out;
};

export const ChangeOverlay = ({
  api,
  diff,
  versionElements,
}: ChangeOverlayProps) => {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!api || !el) {
      return;
    }
    const versionMap = toMap(versionElements);
    const added = boundsOf(diff.added, versionMap);
    const changed = boundsOf(diff.changed, versionMap);
    const ghostMap = toMap(diff.removed);
    const ghosts = boundsOf(
      diff.removed.map((e) => e.id),
      ghostMap,
    );
    let frame = 0;

    const draw = () => {
      frame = 0;
      const ctx = el.getContext?.("2d");
      const host = el.parentElement;
      if (!ctx || !host) {
        return;
      }
      const dpr = el.ownerDocument.defaultView?.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (
        el.width !== Math.round(w * dpr) ||
        el.height !== Math.round(h * dpr)
      ) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { scrollX, scrollY, zoom } = api.getAppState();
      const z = zoom.value;
      const pad = 3;
      const stroke = (boxes: Box[], color: string, dash: number[]) => {
        ctx.strokeStyle = color;
        ctx.setLineDash(dash);
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of boxes) {
          const sx = (x1 + scrollX) * z - pad;
          const sy = (y1 + scrollY) * z - pad;
          const sw = (x2 - x1) * z + pad * 2;
          const sh = (y2 - y1) * z + pad * 2;
          if (sx > w || sy > h || sx + sw < 0 || sy + sh < 0) {
            continue;
          }
          ctx.rect(sx, sy, sw, sh);
        }
        ctx.stroke();
      };
      ctx.lineWidth = 2;
      stroke(added, HIGHLIGHT_COLORS.added, []);
      stroke(changed, HIGHLIGHT_COLORS.changed, []);
      stroke(ghosts, HIGHLIGHT_COLORS.removed, [6, 4]);
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(draw);
      }
    };

    const offScroll = api.onScrollChange(schedule);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    if (el.parentElement) {
      ro?.observe(el.parentElement);
    }
    schedule();
    return () => {
      offScroll();
      ro?.disconnect();
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [api, diff, versionElements]);

  return (
    <canvas
      ref={canvas}
      className="vault-change-overlay"
      data-testid="history-change-overlay"
      aria-hidden="true"
    />
  );
};
