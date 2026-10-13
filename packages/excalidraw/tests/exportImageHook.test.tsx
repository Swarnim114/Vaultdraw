import React from "react";
import { vi, type MockInstance } from "vitest";

import { actionCopyAsPng, actionCopyAsSvg } from "../actions/actionClipboard";
import * as dataModule from "../data/index";
import { CommandPalette } from "../components/CommandPalette/CommandPalette";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  GlobalTestState,
} from "./test-utils";

const { h } = window;

const setup = async (props: React.ComponentProps<typeof Excalidraw> = {}) => {
  await render(<Excalidraw {...props} />);
  API.setElements([
    API.createElement({ type: "rectangle", id: "A", width: 100, height: 80 }),
  ]);
};

const openDialog = async () => {
  API.updateScene({ appState: { openDialog: { name: "imageExport" } } });
  await waitFor(() => {
    expect(
      GlobalTestState.renderResult.container.ownerDocument.querySelector(
        ".ImageExportModal",
      ),
    ).not.toBeNull();
  });
};

describe("onExportImage host hook", () => {
  let exportCanvasSpy: MockInstance<typeof dataModule.exportCanvas>;

  beforeEach(() => {
    exportCanvasSpy = vi
      .spyOn(dataModule, "exportCanvas")
      .mockResolvedValue(null as any);
  });

  afterEach(() => {
    exportCanvasSpy.mockRestore();
  });

  it.each([
    ["Export to PNG", "png"],
    ["Export to SVG", "svg"],
    ["Copy PNG to clipboard", "clipboard"],
    ["Copy SVG to clipboard", "clipboard-svg"],
  ])("dialog button %s calls the host hook with %s", async (label, type) => {
    const onExportImage = vi.fn().mockResolvedValue(undefined);
    await setup({ onExportImage });
    await openDialog();

    fireEvent.click(screen.getByLabelText(label));

    await waitFor(() => expect(onExportImage).toHaveBeenCalledTimes(1));
    const request = onExportImage.mock.calls[0][0];
    expect(request.type).toBe(type);
    expect(request.elements.map((el: { id: string }) => el.id)).toEqual(["A"]);
    expect(request.exportingFrame).toBe(null);
    expect(request.files).toBe(h.app.files);
    expect(request.appState.exportScale).toBe(h.state.exportScale);
    expect(request.name).toBe(h.app.getName());
    expect(exportCanvasSpy).not.toHaveBeenCalled();
  });

  it("hides the filename input when the host handles export", async () => {
    await setup({ onExportImage: vi.fn() });
    await openDialog();
    expect(document.querySelector(".ImageExportModal input.TextInput")).toBe(
      null,
    );
  });

  it("shows host errors from the dialog buttons", async () => {
    const onExportImage = vi.fn().mockRejectedValue(new Error("boom"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await setup({ onExportImage });
    await openDialog();

    fireEvent.click(screen.getByLabelText("Export to PNG"));

    await waitFor(() => expect(h.state.errorMessage).toBe("boom"));
    consoleError.mockRestore();
  });

  it.each([
    ["actionCopyAsPng", actionCopyAsPng, "clipboard"],
    ["actionCopyAsSvg", actionCopyAsSvg, "clipboard-svg"],
  ])("%s calls the host hook with %s", async (_name, action, type) => {
    const onExportImage = vi.fn().mockResolvedValue(undefined);
    await setup({ onExportImage });

    h.app.actionManager.executeAction(action);

    await waitFor(() => expect(onExportImage).toHaveBeenCalledTimes(1));
    expect(onExportImage.mock.calls[0][0].type).toBe(type);
    expect(onExportImage.mock.calls[0][0].elements).toHaveLength(1);
    expect(exportCanvasSpy).not.toHaveBeenCalled();
  });

  it("copy actions show the host error", async () => {
    const onExportImage = vi.fn().mockRejectedValue(new Error("nope"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await setup({ onExportImage });

    h.app.actionManager.executeAction(actionCopyAsSvg);

    await waitFor(() => expect(h.state.errorMessage).toBe("nope"));
    consoleError.mockRestore();
  });

  it("rejects an empty export without calling the host hook", async () => {
    const onExportImage = vi.fn();
    await setup({ onExportImage });

    await expect(h.app.exportImage("png", [] as any, null)).rejects.toThrow(
      "Cannot export empty canvas.",
    );
    expect(onExportImage).not.toHaveBeenCalled();
  });

  it("falls back to exportCanvas when no hook is set", async () => {
    await setup();

    h.app.actionManager.executeAction(actionCopyAsSvg);

    await waitFor(() => expect(exportCanvasSpy).toHaveBeenCalledTimes(1));
    expect(exportCanvasSpy.mock.calls[0][0]).toBe("clipboard-svg");
  });

  it("dialog buttons use exportCanvas when no hook is set", async () => {
    await setup();
    await openDialog();

    fireEvent.click(screen.getByLabelText("Export to SVG"));

    await waitFor(() => expect(exportCanvasSpy).toHaveBeenCalledTimes(1));
    expect(exportCanvasSpy.mock.calls[0][0]).toBe("svg");
  });
});

describe("command palette", () => {
  it("lists Mermaid but not text-to-diagram when aiEnabled is false", async () => {
    await render(
      <Excalidraw aiEnabled={false}>
        <CommandPalette />
      </Excalidraw>,
    );
    API.updateScene({ appState: { openDialog: { name: "commandPalette" } } });

    await waitFor(() => {
      expect(screen.getByText("Mermaid to Excalidraw...")).not.toBeNull();
    });
    expect(screen.queryByText("Text to diagram...")).toBeNull();
  });
});
