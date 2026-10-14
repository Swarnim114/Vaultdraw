// Vaultdraw: byte-budgeted LRU for the per-element bitmap cache.
//
// Upstream used a WeakMap, so every element kept a canvas (up to ~64 MB each)
// for as long as the element object lived, and replaced canvases waited for GC
// to free their backing store. For large scenes that dominates WebContent
// memory. This keeps the same get/set/delete/has shape, but:
//  - bounds the total bytes held by entries that are NOT used in the current
//    frame (the visible set is never evicted, so panning/zooming never
//    re-rasterises what is on screen every frame),
//  - zeroes canvas width/height on eviction/replacement so WebKit frees the
//    backing store immediately.

/** Off-screen cache budget. A full Retina viewport is ~20 MB of bitmaps, so
 * 64 MiB keeps a couple of screens of neighbours for smooth panning. The
 * budget is soft for the visible set. */
export const ELEMENT_CANVAS_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

type CanvasHolder = { canvas: HTMLCanvasElement };

type Entry<V extends CanvasHolder> = {
  value: V;
  bytes: number;
  frame: number;
};

const canvasBytes = (canvas: HTMLCanvasElement) =>
  canvas.width * canvas.height * 4;

const releaseCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = canvas.height = 0;
};

export class ElementCanvasCache<K extends object, V extends CanvasHolder> {
  // Map preserves insertion order: first key = least recently used
  private map = new Map<K, Entry<V>>();
  private totalBytes = 0;
  private frame = 0;

  constructor(private budget: number = ELEMENT_CANVAS_CACHE_BUDGET_BYTES) {}

  /** call once at the start of every static scene render */
  beginFrame() {
    this.frame++;
    this.evict();
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    entry.frame = this.frame;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: K) {
    return this.map.has(key);
  }

  set(key: K, value: V) {
    this.delete(key);
    const bytes = canvasBytes(value.canvas);
    this.map.set(key, { value, bytes, frame: this.frame });
    this.totalBytes += bytes;
    this.evict();
    return this;
  }

  delete(key: K) {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }
    this.map.delete(key);
    this.totalBytes -= entry.bytes;
    releaseCanvas(entry.value.canvas);
    return true;
  }

  clear() {
    for (const entry of this.map.values()) {
      releaseCanvas(entry.value.canvas);
    }
    this.map.clear();
    this.totalBytes = 0;
  }

  get size() {
    return this.map.size;
  }

  get bytes() {
    return this.totalBytes;
  }

  private evict() {
    if (this.totalBytes <= this.budget) {
      return;
    }
    for (const [key, entry] of this.map) {
      if (this.totalBytes <= this.budget) {
        break;
      }
      // LRU order: everything after the first current-frame entry was used
      // in the current frame too, so nothing evictable remains.
      if (entry.frame === this.frame) {
        break;
      }
      this.delete(key);
    }
  }
}
