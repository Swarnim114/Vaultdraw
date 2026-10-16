import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import VersionPreview from "../history/preview/VersionPreview";

import type { LoadedVersion } from "../history/preview/versionCache";

const version = (id: string): LoadedVersion => ({
  id,
  fileRevision: "r",
  elements: [
    {
      id: `${id}-rect`,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      version: 1,
      versionNonce: 1,
      index: "a0",
      isDeleted: false,
    } as any,
  ],
  appState: { viewBackgroundColor: "#abcdef" },
  files: {},
  imagesLoaded: true,
  elementCount: 1,
});

describe("VersionPreview", () => {
  it("shows a version, reuses the instance across versions and reports its api", async () => {
    const onApi = vi.fn();
    const viewport = { scrollX: 3, scrollY: 4, zoom: 1 };
    const { rerender, unmount, container } = render(
      <VersionPreview
        version={version("v1")}
        initialViewport={viewport}
        theme="light"
        onApi={onApi}
      />,
    );
    await act(async () => {});
    const api = onApi.mock.calls.find((c) => c[0])?.[0];
    expect(api).toBeTruthy();
    expect(api.getSceneElements().map((e: any) => e.id)).toEqual(["v1-rect"]);
    expect(api.getAppState().viewBackgroundColor).toBe("#abcdef");
    expect(api.getAppState().scrollX).toBe(3);

    const canvases = container.querySelectorAll("canvas").length;
    rerender(
      <VersionPreview
        version={version("v2")}
        initialViewport={viewport}
        theme="light"
        onApi={onApi}
      />,
    );
    await act(async () => {});
    expect(api.getSceneElements().map((e: any) => e.id)).toEqual(["v2-rect"]);
    expect(container.querySelectorAll("canvas").length).toBe(canvases);
    // Viewport is kept across versions.
    expect(api.getAppState().scrollX).toBe(3);

    unmount();
    expect(onApi).toHaveBeenLastCalledWith(null);
  });

  it("renders nothing without a version", () => {
    const { container } = render(
      <VersionPreview version={null} initialViewport={null} theme="dark" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
