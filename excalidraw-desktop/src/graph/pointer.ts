/**
 * Pointer and wheel input for the graph stage: hover pick, click-to-open, node drag, background
 * pan and wheel zoom. Listeners exist only while the graph is open (the returned function
 * removes them).
 */
import { Camera } from "./camera";

import type { GraphSession } from "./GraphSession";

const CLICK_SLOP = 4;

export function bindPointer(
  el: HTMLElement,
  session: GraphSession,
  onInteract: () => void,
): () => void {
  let down: { x: number; y: number; node: number; id: number } | null = null;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    const p = local(e);
    onInteract();
    down = {
      x: p.x,
      y: p.y,
      node: session.pickScreen(p.x, p.y),
      id: e.pointerId,
    };
    moved = false;
    lastX = p.x;
    lastY = p.y;
    el.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (!down) {
      session.hoverAt(p.x, p.y);
      return;
    }
    if (!moved && Math.hypot(p.x - down.x, p.y - down.y) < CLICK_SLOP) {
      return;
    }
    if (!moved) {
      moved = true;
      if (down.node >= 0) {
        session.beginDrag(down.node);
        session.hoverAt(p.x, p.y);
      }
    }
    if (down.node >= 0) {
      session.dragTo(p.x, p.y);
    } else {
      session.panBy(p.x - lastX, p.y - lastY);
    }
    lastX = p.x;
    lastY = p.y;
  };

  const onUp = (e: PointerEvent) => {
    if (!down) {
      return;
    }
    const d = down;
    down = null;
    el.releasePointerCapture?.(d.id);
    if (moved) {
      session.endDrag();
    } else if (d.node >= 0) {
      session.activate(d.node);
    }
    const p = local(e);
    session.hoverAt(p.x, p.y);
  };

  const onLeave = () => {
    if (!down) {
      session.hoverLeave();
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    onInteract();
    const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    session.zoomAt(p.x, p.y, Camera.wheelFactor(dy));
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("pointerleave", onLeave);
    el.removeEventListener("wheel", onWheel);
  };
}
