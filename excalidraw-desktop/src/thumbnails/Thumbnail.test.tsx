import { describe, expect, it, vi } from "vitest";

import { act, fireEvent, render } from "@testing-library/react";

import { ThumbnailProvider } from "./context";
import { THUMB_LOADING } from "./service";
import { Thumbnail } from "./Thumbnail";

import type { ThumbState, ThumbnailService } from "./service";

const fakeService = () => {
  let cb: ((s: ThumbState) => void) | null = null;
  const unwatch = vi.fn();
  const service: ThumbnailService = {
    watch: vi.fn((_p, c) => {
      cb = c;
      c(THUMB_LOADING);
      return unwatch;
    }),
    noteSaved: vi.fn(),
    invalidate: vi.fn(),
    refresh: vi.fn(),
    setEnabled: vi.fn(),
    dispose: vi.fn(),
  };
  return { service, push: (s: ThumbState) => act(() => cb?.(s)), unwatch };
};

describe("<Thumbnail>", () => {
  it("renders nothing without a provider or with a null service", () => {
    const a = render(<Thumbnail path="a" size="md" />);
    expect(a.container.innerHTML).toBe("");
    const b = render(
      <ThumbnailProvider service={null}>
        <Thumbnail path="a" size="md" />
      </ThumbnailProvider>,
    );
    expect(b.container.innerHTML).toBe("");
  });

  it("shows a placeholder, then the lazy image, and unwatches on unmount", () => {
    const { service, push, unwatch } = fakeService();
    const { container, unmount } = render(
      <ThumbnailProvider service={service}>
        <Thumbnail path="a.excalidraw" size="sm" className="x" />
      </ThumbnailProvider>,
    );
    const ph = container.querySelector(".vault-thumb--placeholder")!;
    expect(ph.className).toContain("vault-thumb--sm");
    expect(container.querySelector("img")).toBeNull();
    push({ status: "ready", url: "vdthumb://localhost/v/r.png" });
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("vdthumb://localhost/v/r.png");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("draggable")).toBe("false");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.className).toBe("vault-thumb vault-thumb--sm x");
    unmount();
    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the placeholder on a broken image and re-checks once per url", () => {
    const { service, push } = fakeService();
    const { container } = render(
      <ThumbnailProvider service={service}>
        <Thumbnail path="a.excalidraw" size="md" />
      </ThumbnailProvider>,
    );
    push({ status: "ready", url: "vdthumb://x/r.png" });
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".vault-thumb--placeholder")).not.toBeNull();
    expect(service.refresh).toHaveBeenCalledWith("a.excalidraw");
    // The service re-renders the same url: tried again, but only one refresh.
    push({ status: "ready", url: "vdthumb://x/r.png" });
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(service.refresh).toHaveBeenCalledTimes(1);
  });
});
