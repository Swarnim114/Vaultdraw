/**
 * Graph camera: `x, y` is the world point at the viewport centre, `scale` is CSS px per world
 * unit. Pure maths plus an optional 200 ms ease-out tween driven by the caller's frame loop
 * (`step(now)` returns true while animating, so rAF only runs during the animation).
 */
import type { CameraState } from "./renderer/types";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export const FIT_MS = 200;
export const DEFAULT_MIN_SCALE = 0.005;
export const DEFAULT_MAX_SCALE = 8;

export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/** Bounding box of visible nodes of a Float32Array(2n); null when none. */
export function computeBounds(
  positions: Float32Array,
  n: number,
  mask?: Uint8Array | null,
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i]) {
      continue;
    }
    const x = positions[2 * i];
    const y = positions[2 * i + 1];
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return minX > maxX ? null : { minX, minY, maxX, maxY };
}

/** Camera that shows `bounds` inside the viewport with `padding` CSS px on every side. */
export function fitCamera(
  bounds: Bounds,
  viewport: Viewport,
  padding = 40,
  maxScale = 2,
  minScale = DEFAULT_MIN_SCALE,
): CameraState {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const aw = Math.max(1, viewport.w - 2 * padding);
  const ah = Math.max(1, viewport.h - 2 * padding);
  const scale = Math.min(
    maxScale,
    Math.max(minScale, Math.min(aw / bw, ah / bh)),
  );
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    scale,
  };
}

export class Camera implements CameraState {
  x = 0;
  y = 0;
  scale = 1;
  minScale = DEFAULT_MIN_SCALE;
  maxScale = DEFAULT_MAX_SCALE;
  /** Optional world rect the centre is clamped into. */
  limits: Bounds | null = null;

  private w = 1;
  private h = 1;
  private from: CameraState = { x: 0, y: 0, scale: 1 };
  private to: CameraState = { x: 0, y: 0, scale: 1 };
  private t0 = 0;
  private dur = 0;
  private animating = false;

  get viewport(): Viewport {
    return { w: this.w, h: this.h };
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  setViewport(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  set(state: CameraState): void {
    this.animating = false;
    this.x = state.x;
    this.y = state.y;
    this.scale = state.scale;
    this.clamp();
  }

  /** World -> screen (CSS px relative to the canvas). */
  worldToScreen(
    wx: number,
    wy: number,
    out: { x: number; y: number } = { x: 0, y: 0 },
  ) {
    out.x = (wx - this.x) * this.scale + this.w / 2;
    out.y = (wy - this.y) * this.scale + this.h / 2;
    return out;
  }

  screenToWorld(
    sx: number,
    sy: number,
    out: { x: number; y: number } = { x: 0, y: 0 },
  ) {
    out.x = (sx - this.w / 2) / this.scale + this.x;
    out.y = (sy - this.h / 2) / this.scale + this.y;
    return out;
  }

  /** Pan by a screen-space delta (drag). */
  panBy(dxPx: number, dyPx: number): void {
    this.animating = false;
    this.x -= dxPx / this.scale;
    this.y -= dyPx / this.scale;
    this.clamp();
  }

  /** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.animating = false;
    const next = Math.min(
      this.maxScale,
      Math.max(this.minScale, this.scale * factor),
    );
    const k = next / this.scale;
    // world point under the pointer stays: x' = wx - (sx - w/2)/next
    const wx = (sx - this.w / 2) / this.scale + this.x;
    const wy = (sy - this.h / 2) / this.scale + this.y;
    this.scale = next;
    this.x = wx - (sx - this.w / 2) / next;
    this.y = wy - (sy - this.h / 2) / next;
    if (k !== 1) {
      this.clamp();
    }
  }

  /** Wheel delta (px, line mode normalised by caller) -> zoom factor. */
  static wheelFactor(deltaY: number): number {
    return Math.exp(-deltaY * 0.0015);
  }

  fit(
    bounds: Bounds,
    padding = 40,
    animate = true,
    now = performance.now(),
  ): void {
    const target = fitCamera(bounds, this.viewport, padding, 2, this.minScale);
    if (animate) {
      this.animateTo(target, now);
    } else {
      this.set(target);
    }
  }

  animateTo(target: CameraState, now: number, durationMs = FIT_MS): void {
    this.from = { x: this.x, y: this.y, scale: this.scale };
    this.to = { ...target };
    this.t0 = now;
    this.dur = durationMs;
    this.animating = durationMs > 0;
    if (!this.animating) {
      this.set(target);
    }
  }

  /** Advances the tween. Returns true while it still needs another frame. */
  step(now: number): boolean {
    if (!this.animating) {
      return false;
    }
    const t = (now - this.t0) / this.dur;
    if (t >= 1) {
      this.x = this.to.x;
      this.y = this.to.y;
      this.scale = this.to.scale;
      this.animating = false;
      return false;
    }
    const e = easeOutCubic(t);
    this.x = this.from.x + (this.to.x - this.from.x) * e;
    this.y = this.from.y + (this.to.y - this.from.y) * e;
    // interpolate zoom geometrically so the motion feels linear in zoom
    this.scale = this.from.scale * Math.pow(this.to.scale / this.from.scale, e);
    return true;
  }

  private clamp(): void {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    const l = this.limits;
    if (l) {
      this.x = Math.min(l.maxX, Math.max(l.minX, this.x));
      this.y = Math.min(l.maxY, Math.max(l.minY, this.y));
    }
  }
}
