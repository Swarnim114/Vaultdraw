import React from "react";
import { vi } from "vitest";

import { Excalidraw } from "../index";

import { render, unmountComponent } from "./test-utils";

import type { BinaryFileData } from "../types";

unmountComponent();

const h = window.h;

const file = (id: string, ok = true): BinaryFileData =>
  ({
    id,
    mimeType: "image/png",
    dataURL: ok ? `data:image/png;base64,${id}` : "data:image/png;base64,BAD",
    created: 1,
  } as unknown as BinaryFileData);

/** jsdom never decodes images: fire load/error right after `src` is set. */
const stubImage = () => {
  const Original = window.Image;
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    set src(value: string) {
      setTimeout(() =>
        value.includes("BAD")
          ? this.onerror?.(new Error("bad"))
          : this.onload?.(),
      );
    }
  }
  window.Image = FakeImage as unknown as typeof Image;
  return () => {
    window.Image = Original;
  };
};

describe("addFiles / retainFiles", () => {
  let restore: () => void;
  beforeEach(async () => {
    restore = stubImage();
    await render(<Excalidraw />);
  });
  afterEach(() => restore());

  it("resolves once the images are in the image cache, with no element using them", async () => {
    const promise = h.app.addFiles([file("a"), file("b")]);
    expect(promise).toBeInstanceOf(Promise);
    await promise;
    for (const id of ["a", "b"]) {
      expect(h.app.imageCache.get(id as any)?.image).toBeInstanceOf(
        window.Image,
      );
    }
    expect(Object.keys(h.app.files).sort()).toEqual(["a", "b"]);
  });

  it("never rejects and leaves a failed image uncached so rendering can flag it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(h.app.addFiles([file("bad", false)])).resolves.toBeUndefined();
    expect(h.app.imageCache.has("bad" as any)).toBe(false);
    spy.mockRestore();
  });

  it("keeps existing files and does not decode them again", async () => {
    await h.app.addFiles([file("a")]);
    const first = h.app.imageCache.get("a" as any);
    await h.app.addFiles([file("a"), file("c")]);
    expect(h.app.imageCache.get("a" as any)).toBe(first);
    expect(Object.keys(h.app.files).sort()).toEqual(["a", "c"]);
  });

  it("retainFiles drops files and decoded images outside the set", async () => {
    await h.app.addFiles([file("a"), file("b"), file("c")]);
    h.app.retainFiles(["b"]);
    expect(Object.keys(h.app.files)).toEqual(["b"]);
    expect([...h.app.imageCache.keys()]).toEqual(["b"]);
    expect(Object.keys(h.app.api.getFiles())).toEqual(["b"]);
  });

  it("is exposed on the imperative API", async () => {
    expect(typeof h.app.api.retainFiles).toBe("function");
    h.app.api.retainFiles([]);
    expect(Object.keys(h.app.files)).toEqual([]);
  });
});
