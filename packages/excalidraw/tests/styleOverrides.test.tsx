import React from "react";

import { Excalidraw } from "../index";

import { UI } from "./helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "./test-utils";

import type { AppState, StyleOverridesHook } from "../types";

const { h } = window;

unmountComponent();

const hook = (
  overridden: (keyof AppState)[],
  useDefault = vi.fn(),
): StyleOverridesHook => ({
  isOverridden: (fields) => fields.some((f) => overridden.includes(f)),
  useDefault,
});

describe("styleOverrides prop", () => {
  const renderWith = async (styleOverrides?: StyleOverridesHook) => {
    const result = await render(
      <Excalidraw handleKeyboardGlobally styleOverrides={styleOverrides} />,
    );
    UI.clickTool("text");
    return result;
  };

  it("renders no marker when nothing is overridden", async () => {
    await renderWith(hook([]));
    expect(screen.queryByTestId("style-use-default-fontFamily")).toBeNull();
    expect(screen.queryByTestId("style-use-default-strokeColor")).toBeNull();
  });

  it("renders no marker without the prop", async () => {
    await renderWith(undefined);
    expect(screen.queryByTestId("style-use-default-fontFamily")).toBeNull();
  });

  it("marks only overridden properties and calls useDefault with their fields", async () => {
    const useDefault = vi.fn();
    await renderWith(hook(["currentItemFontFamily"], useDefault));
    const button = screen.getByTestId("style-use-default-fontFamily");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toMatch(/^Use default /);
    expect(screen.queryByTestId("style-use-default-fontSize")).toBeNull();
    fireEvent.click(button);
    expect(useDefault).toHaveBeenCalledTimes(1);
    expect(useDefault).toHaveBeenCalledWith(["currentItemFontFamily"]);
  });

  it("marks colour and opacity headings", async () => {
    await renderWith(hook(["currentItemStrokeColor", "currentItemOpacity"]));
    expect(screen.getByTestId("style-use-default-strokeColor")).toBeTruthy();
    expect(screen.getByTestId("style-use-default-opacity")).toBeTruthy();
  });

  it("updates when a new hook object is passed", async () => {
    const { rerender } = await renderWith(hook([]));
    expect(screen.queryByTestId("style-use-default-fontFamily")).toBeNull();
    await act(async () => {
      rerender(
        <Excalidraw
          handleKeyboardGlobally
          styleOverrides={hook(["currentItemFontFamily"])}
        />,
      );
    });
    expect(screen.getByTestId("style-use-default-fontFamily")).toBeTruthy();
    await act(async () => {
      rerender(<Excalidraw handleKeyboardGlobally styleOverrides={hook([])} />);
    });
    expect(screen.queryByTestId("style-use-default-fontFamily")).toBeNull();
  });

  it("shows the marker inside the compact panel popovers", async () => {
    // radix popovers measure their content
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const useDefault = vi.fn();
    await render(
      <Excalidraw
        handleKeyboardGlobally
        UIOptions={{ getFormFactor: () => "tablet" }}
        styleOverrides={hook(
          ["currentItemFontFamily", "currentItemStrokeColor"],
          useDefault,
        )}
      />,
    );
    fireEvent.resize(window);
    await waitFor(() =>
      expect(h.app.editorInterface.formFactor).toBe("tablet"),
    );
    UI.clickTool("text");

    // closed popovers show nothing
    expect(screen.queryByTestId("style-use-default-fontFamily")).toBeNull();

    fireEvent.click(await screen.findByTestId("font-family-show-fonts"));
    fireEvent.click(await screen.findByTestId("style-use-default-fontFamily"));
    expect(useDefault).toHaveBeenLastCalledWith(["currentItemFontFamily"]);

    fireEvent.click(
      document.querySelector(".color-picker__button.active-color")!,
    );
    fireEvent.click(await screen.findByTestId("style-use-default-strokeColor"));
    expect(useDefault).toHaveBeenLastCalledWith(["currentItemStrokeColor"]);
    vi.unstubAllGlobals();
  });
});
