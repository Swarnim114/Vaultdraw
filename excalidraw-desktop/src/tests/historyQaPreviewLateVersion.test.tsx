import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import VersionPreview from "../history/preview/VersionPreview";

import type { LoadedVersion } from "../history/preview/versionCache";

const version: LoadedVersion = {
  id: "v1",
  fileRevision: "r",
  elements: [
    {
      id: "one",
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
  appState: {},
  files: {},
  imagesLoaded: true,
  elementCount: 1,
};

describe("VersionPreview mounted before its version has loaded", () => {
  // Regression (H2 QA BUG-P1): the panel mounts the preview as soon as a row
  // is selected, before the scene has loaded; initialData must be taken from
  // the first non-null version, not at mount.
  it("shows the version once it arrives", async () => {
    const onApi = vi.fn();
    const props = {
      initialViewport: null,
      theme: "light" as const,
      onApi,
    };
    const { rerender } = render(<VersionPreview version={null} {...props} />);
    await act(async () => {});
    rerender(<VersionPreview version={version} {...props} />);
    await act(async () => {});
    const api = onApi.mock.calls.find((c) => c[0])?.[0];
    expect(api).toBeTruthy();
    expect(api.getSceneElements().map((e: any) => e.id)).toEqual(["one"]);
  });
});
