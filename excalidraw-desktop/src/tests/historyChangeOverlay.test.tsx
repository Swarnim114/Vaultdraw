import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { PreviewOverlay } from "../history/panel/PreviewOverlay";

const fakeApi = {
  getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
  onScrollChange: () => () => {},
};
vi.mock("../history/preview/VersionPreview", async () => {
  const { useEffect } = await import("react");
  const MockPreview = ({ onApi }: { onApi?: (api: unknown) => void }) => {
    useEffect(() => {
      onApi?.(fakeApi);
    }, [onApi]);
    return null;
  };
  return { default: MockPreview };
});

const el = (id: string, version = 1) =>
  ({
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version,
    versionNonce: version,
    isDeleted: false,
  } as any);

const version = {
  id: "v",
  fileRevision: "r",
  elements: [el("a"), el("c", 2)],
  appState: {},
  files: {},
  imagesLoaded: true,
  elementCount: 2,
} as any;

const mount = (props: Record<string, unknown> = {}) => {
  const target = document.createElement("div");
  document.body.appendChild(target);
  return render(
    <PreviewOverlay
      target={target}
      fullscreen={false}
      version={version}
      title="v"
      time="now"
      canCopy={false}
      initialViewport={null}
      theme="light"
      onRestore={() => {}}
      onCopy={() => {}}
      onBack={() => {}}
      getCurrentElements={() => [el("c"), el("d")]}
      {...props}
    />,
  );
};

describe("change highlights", () => {
  it("renders legend counts and the overlay canvas", async () => {
    const { unmount } = mount();
    await act(async () => {});
    const legend = await screen.findByTestId("history-legend");
    expect(legend.textContent).toContain("Only in this version 1");
    expect(legend.textContent).toContain("Changed since 1");
    expect(legend.textContent).toContain("Not in this version 1");
    expect(screen.getByTestId("history-change-overlay")).toBeTruthy();
    unmount();
  });

  it("binds the toggle command only while mounted and removes the canvas when off", async () => {
    expect(getRegisteredHandler("history.toggleHighlights")).toBeUndefined();
    const { unmount } = mount();
    await act(async () => {});
    const handler = getRegisteredHandler("history.toggleHighlights");
    expect(handler).toBeTruthy();
    await act(async () => {
      await handler!();
    });
    expect(screen.queryByTestId("history-change-overlay")).toBeNull();
    expect(screen.queryByTestId("history-legend")).toBeNull();
    expect(
      screen.getByTestId("history-highlights").getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(screen.getByTestId("history-highlights"));
    expect(screen.getByTestId("history-change-overlay")).toBeTruthy();
    unmount();
    expect(getRegisteredHandler("history.toggleHighlights")).toBeUndefined();
  });

  it("starts off when the setting is off, and is absent without a current scene", async () => {
    const off = mount({ highlightChanges: false });
    await act(async () => {});
    expect(screen.queryByTestId("history-change-overlay")).toBeNull();
    off.unmount();
    const none = mount({ getCurrentElements: undefined });
    await act(async () => {});
    expect(screen.queryByTestId("history-highlights")).toBeNull();
    none.unmount();
  });
});
