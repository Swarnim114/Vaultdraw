import {
  ElementCanvasCache,
  ELEMENT_CANVAS_CACHE_BUDGET_BYTES,
} from "../src/elementCanvasCache";

// 100x100 canvas = 40,000 bytes
const entry = () => ({
  canvas: { width: 100, height: 100 } as HTMLCanvasElement,
});
const B = 40_000;

describe("ElementCanvasCache", () => {
  it("has a sane default budget", () => {
    expect(ELEMENT_CANVAS_CACHE_BUDGET_BYTES).toBe(16 * 1024 * 1024);
  });

  it("evicts off-screen entries beyond budget, releasing canvases", () => {
    const cache = new ElementCanvasCache<object, any>(B);
    const [a, b, c] = [{}, {}, {}];
    const ea = entry();
    cache.set(a, ea);
    cache.set(b, entry());
    cache.beginFrame();
    cache.beginFrame();
    cache.set(c, entry());
    // nothing evicts on set; the next frame trims off-screen entries
    cache.get(c);
    cache.beginFrame();
    expect(cache.has(a)).toBe(false);
    expect(ea.canvas.width).toBe(0);
    expect(ea.canvas.height).toBe(0);
    // one off-screen entry (the newer) stays within the allowance
    expect(cache.has(b)).toBe(true);
    expect(cache.bytes).toBe(B * 2);
  });

  it("the budget is an allowance on top of the visible set", () => {
    const cache = new ElementCanvasCache<object, any>(B);
    const visible = [{}, {}, {}];
    const away = [{}, {}];
    [...visible, ...away].forEach((k) => cache.set(k, entry()));
    cache.beginFrame();
    visible.forEach((k) => cache.get(k));
    cache.beginFrame();
    visible.forEach((k) => cache.get(k));
    cache.beginFrame();
    // 3 visible kept, 1 off-screen allowed, the older off-screen one is gone
    expect(cache.size).toBe(4);
    expect(cache.has(away[0])).toBe(false);
    expect(cache.has(away[1])).toBe(true);
  });

  it("trims off-screen entries after the idle delay, keeping the visible set", () => {
    vi.useFakeTimers();
    try {
      const cache = new ElementCanvasCache<object, any>(B * 10, 5000);
      const [shown, away] = [{}, {}];
      const ea = entry();
      cache.set(shown, entry());
      cache.set(away, ea);
      cache.beginFrame();
      cache.get(shown);
      cache.beginFrame();
      cache.get(shown);
      expect(cache.size).toBe(2);
      vi.advanceTimersByTime(4999);
      expect(cache.size).toBe(2);
      // a new render restarts the idle clock
      cache.beginFrame();
      cache.get(shown);
      vi.advanceTimersByTime(4999);
      expect(cache.size).toBe(2);
      vi.advanceTimersByTime(1);
      expect(cache.has(away)).toBe(false);
      expect(cache.has(shown)).toBe(true);
      expect(ea.canvas.width).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never evicts current-frame entries (soft budget)", () => {
    const cache = new ElementCanvasCache<object, any>(B);
    const keys = [{}, {}, {}];
    keys.forEach((k) => cache.set(k, entry()));
    expect(cache.size).toBe(3);
    cache.beginFrame();
    // the previous frame's entries are kept: they are what is on screen
    expect(cache.size).toBe(3);
    cache.beginFrame();
    // a frame later, none used: trimmed down to the budget
    expect(cache.size).toBe(1);
  });

  it("keeps an on-screen set larger than the budget across frames", () => {
    const cache = new ElementCanvasCache<object, any>(B);
    const keys = [{}, {}, {}];
    const values = keys.map(() => entry());
    keys.forEach((k, i) => cache.set(k, values[i]));
    for (let frame = 0; frame < 3; frame++) {
      cache.beginFrame();
      // the same three elements are drawn every frame: none re-created
      keys.forEach((k, i) => expect(cache.get(k)).toBe(values[i]));
    }
    expect(values.every((v) => v.canvas.width === 100)).toBe(true);
  });

  it("re-get marks entry most-recently-used", () => {
    const cache = new ElementCanvasCache<object, any>(0);
    const [a, b, c] = [{}, {}, {}];
    cache.set(a, entry());
    cache.set(b, entry());
    cache.beginFrame();
    cache.get(a);
    cache.beginFrame();
    cache.get(a);
    cache.set(c, entry());
    cache.beginFrame();
    expect(cache.has(a)).toBe(true);
    expect(cache.has(b)).toBe(false);
  });

  it("zeroes replaced canvases and tracks bytes", () => {
    const cache = new ElementCanvasCache<object, any>();
    const k = {};
    const e1 = entry();
    cache.set(k, e1);
    cache.set(k, entry());
    expect(e1.canvas.width).toBe(0);
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(B);
  });

  it("delete and clear release everything", () => {
    const cache = new ElementCanvasCache<object, any>();
    const [a, b] = [{}, {}];
    const ea = entry();
    const eb = entry();
    cache.set(a, ea);
    cache.set(b, eb);
    expect(cache.delete(a)).toBe(true);
    expect(ea.canvas.width).toBe(0);
    cache.clear();
    expect(eb.canvas.height).toBe(0);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
