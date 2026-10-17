import React from "react";
import { vi } from "vitest";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { render, unmountComponent, waitFor } from "./test-utils";

unmountComponent();

const h = window.h;
const mouse = new Pointer("mouse");

// Vaultdraw: `onImageEdit` lets the host take over double-click / Enter on a
// single selected image (formulas) instead of starting the crop editor.
const setup = async (onImageEdit?: (el: any) => boolean) => {
  await render(<Excalidraw handleKeyboardGlobally onImageEdit={onImageEdit} />);
  const image = API.createElement({
    type: "image",
    x: 100,
    y: 100,
    width: 100,
    height: 60,
  });
  API.updateScene({ elements: [image] });
  API.setSelectedElements([image]);
  return image;
};

describe("onImageEdit", () => {
  it("double-click: true skips cropping", async () => {
    const hook = vi.fn(() => true);
    const image = await setup(hook);
    mouse.doubleClickAt(150, 130);
    expect(hook).toHaveBeenCalledTimes(1);
    expect((hook.mock.calls[0] as any[])[0].id).toBe(image.id);
    expect(h.state.croppingElementId).toBeNull();
  });

  it("double-click: false starts cropping", async () => {
    const hook = vi.fn(() => false);
    const image = await setup(hook);
    mouse.doubleClickAt(150, 130);
    expect(hook).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.state.croppingElementId).toBe(image.id));
  });

  it("double-click: absent prop starts cropping", async () => {
    const image = await setup();
    mouse.doubleClickAt(150, 130);
    await waitFor(() => expect(h.state.croppingElementId).toBe(image.id));
  });

  it("Enter: true skips cropping", async () => {
    const hook = vi.fn(() => true);
    const image = await setup(hook);
    Keyboard.keyPress(KEYS.ENTER);
    expect(hook).toHaveBeenCalledTimes(1);
    expect((hook.mock.calls[0] as any[])[0].id).toBe(image.id);
    expect(h.state.croppingElementId).toBeNull();
  });

  it("Enter: false / absent starts cropping", async () => {
    const image = await setup(() => false);
    Keyboard.keyPress(KEYS.ENTER);
    expect(h.state.croppingElementId).toBe(image.id);
  });

  it("Enter: absent prop starts cropping", async () => {
    const image = await setup();
    Keyboard.keyPress(KEYS.ENTER);
    expect(h.state.croppingElementId).toBe(image.id);
  });
});
