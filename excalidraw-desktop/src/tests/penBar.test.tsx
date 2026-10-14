import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PenBar } from "../pens/PenBar";
import { DEFAULT_PEN_PRESETS } from "../pens/penPresets";
import { usePens } from "../pens/usePens";

describe("PenBar", () => {
  it("renders chips with shortcut titles, marks the active one and selects", () => {
    const onSelect = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <PenBar
        presets={DEFAULT_PEN_PRESETS}
        active={1}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
      />,
    );
    const marker = screen.getByRole("button", { name: "Marker" });
    expect(marker).toHaveAttribute("aria-pressed", "true");
    expect(marker).toHaveAttribute("title", "Marker (Alt+2)");
    expect(screen.getByRole("button", { name: "Red pen" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Red pen" }));
    expect(onSelect).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Pens settings" }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

const state = (over: Record<string, unknown> = {}) =>
  ({
    activeTool: { type: "freedraw" },
    currentItemStrokeColor: "#1e1e1e",
    currentItemOpacity: 100,
    currentItemStrokeVariability: "variable",
    currentItemStrokeWidthKey: "thin",
    ...over,
  } as any);

const setup = (enabled = true) => {
  const api = { updateScene: vi.fn(), setActiveTool: vi.fn() };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const hook = renderHook(() =>
    usePens({ current: api as any }, { current: host }, enabled),
  );
  return { api, host, hook };
};

const altDigit = (code: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", {
    code,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe("usePens", () => {
  it("selects a preset with Alt+digit only while freedraw is active", () => {
    const { api, hook } = setup();
    expect(altDigit("Digit2").defaultPrevented).toBe(false);
    expect(api.updateScene).not.toHaveBeenCalled();

    act(() => hook.result.current.onAppState(state()));
    expect(hook.result.current.freedrawActive).toBe(true);

    expect(altDigit("Digit2").defaultPrevented).toBe(true);
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: {
        currentItemStrokeColor: "#1e1e1e",
        currentItemOpacity: 100,
        currentItemStrokeVariability: "constant",
      },
    });
    expect(api.setActiveTool).toHaveBeenCalledWith({ type: "freedraw" });
    expect(hook.result.current.active).toBe(1);
    expect(hook.result.current.freedrawPen()).toMatchObject({ behind: false });
    // out of range / text inputs are ignored
    expect(altDigit("Digit9").defaultPrevented).toBe(false);
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(altDigit("Digit1", input).defaultPrevented).toBe(false);
  });

  it("drops the active preset when colour is changed manually", () => {
    const { hook } = setup();
    act(() => hook.result.current.onAppState(state()));
    act(() => hook.result.current.selectPen(3));
    const applied = {
      currentItemStrokeColor: "#e03131",
      currentItemOpacity: 100,
      currentItemStrokeVariability: "constant",
    };
    act(() => hook.result.current.onAppState(state(applied)));
    expect(hook.result.current.active).toBe(3);
    act(() =>
      hook.result.current.onAppState(
        state({ ...applied, currentItemStrokeColor: "#000000" }),
      ),
    );
    expect(hook.result.current.active).toBeNull();
    expect(hook.result.current.freedrawPen()).toBeNull();
  });

  it("keeps stable getter identities and ignores selection when disabled", () => {
    const { api, hook } = setup(false);
    const { freedrawPen, laserPointerOptions } = hook.result.current;
    act(() => hook.result.current.onAppState(state()));
    hook.rerender();
    expect(hook.result.current.freedrawPen).toBe(freedrawPen);
    expect(hook.result.current.laserPointerOptions).toBe(laserPointerOptions);
    expect(altDigit("Digit1").defaultPrevented).toBe(false);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(laserPointerOptions()).toHaveProperty("decayMs");
  });
});
