import {
  getDisplayColorKey,
  setDisplayColorTransform,
  subscribeDisplayColorTransform,
} from "@excalidraw/common";

describe("display colour key", () => {
  afterEach(() => {
    setDisplayColorTransform(null);
  });

  it("is 'none' without a transform", () => {
    expect(getDisplayColorKey()).toBe("none");
  });

  it("stays stable when the same transform is installed again", () => {
    const fn = (color: string) => color;
    setDisplayColorTransform(fn, "#111111");
    const first = getDisplayColorKey();
    expect(first).not.toBe("none");
    setDisplayColorTransform(null);
    setDisplayColorTransform(fn, "#111111");
    expect(getDisplayColorKey()).toBe(first);
  });

  it("differs for another function or another canvas background", () => {
    const a = (color: string) => color;
    const b = (color: string) => color;
    setDisplayColorTransform(a, "#111111");
    const keyA = getDisplayColorKey();
    setDisplayColorTransform(b, "#111111");
    const keyB = getDisplayColorKey();
    setDisplayColorTransform(a, "#222222");
    const keyA2 = getDisplayColorKey();
    expect(new Set([keyA, keyB, keyA2]).size).toBe(3);
  });

  it("notifies subscribers on set and clear until unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayColorTransform(listener);
    setDisplayColorTransform((color) => color);
    setDisplayColorTransform(null);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setDisplayColorTransform((color) => color);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
