// Vaultdraw: byte-budgeted LRU for the per-element bitmap cache.
//
// Upstream used a WeakMap, so every element kept a canvas (up to ~64 MB each)
// for as long as the element object lived, and replaced canvases waited for GC
// to free their backing store. For large scenes that dominates WebContent
// memory. This keeps the same get/set/delete/has shape, but:
//  - bounds the total bytes held by entries that are NOT used in the current
//    frame or the previous one (the visible set is never evicted, so panning/zooming never
//    re-rasterises what is on screen every frame),
//  - zeroes canvas width/height on eviction/replacement so WebKit frees the
//    backing store immediately.

/** Allowance for entries that are NOT on screen (not drawn in the current or
 * previous frame), on top of the visible set, which is never evicted. 16 MiB
 * keeps roughly a screen edge of neighbours for smooth panning. */
export const ELEMENT_CANVAS_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;

/** After this long without a static render, off-screen entries are released. */
export const ELEMENT_CANVAS_CACHE_IDLE_TRIM_MS = 5000;

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

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private budget: number = ELEMENT_CANVAS_CACHE_BUDGET_BYTES,
    private idleTrimMs: number = ELEMENT_CANVAS_CACHE_IDLE_TRIM_MS,
  ) {}

  /** call once at the start of every static scene render */
  beginFrame() {
    this.frame++;
    this.evict();
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.trimOffscreen();
    }, this.idleTrimMs);
  }

  /** release every entry that was not drawn in the last frame */
  trimOffscreen() {
    for (const [key, entry] of this.map) {
      if (entry.frame >= this.frame) {
        break;
      }
      this.delete(key);
    }
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
    // no eviction here: the new entry is on screen, and everything else is
    // trimmed at the next `beginFrame`
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
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
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
    // Entries drawn in the previous frame are on screen too: `beginFrame`
    // runs before the new frame touches anything, so protecting only the
    // current frame evicted the on-screen set whenever it exceeded the
    // budget, and every visible element was re-rasterised every frame.
    // The budget is the allowance for everything else.
    let visibleBytes = 0;
    for (const entry of this.map.values()) {
      if (entry.frame >= this.frame - 1) {
        visibleBytes += entry.bytes;
      }
    }
    // LRU order: the first protected entry ends the evictable prefix.
    for (const [key, entry] of this.map) {
      if (this.totalBytes - visibleBytes <= this.budget) {
        break;
      }
      if (entry.frame >= this.frame - 1) {
        break;
      }
      this.delete(key);
    }
  }
}
