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
import { PEN_COMMAND_HANDLERS } from "../pens/penCommands";
import { detectPlatform, formatChord } from "../commands/keys";
import { useCommandDispatcher } from "../commands/useCommands";
import { updatePreferences } from "../vault/preferences";

describe("PenBar", () => {
  it("renders chips with shortcut titles, marks the active one and selects", () => {
    const onSelect = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <PenBar
        presets={DEFAULT_PEN_PRESETS}
        shortcuts={["⌥1", "⌥2", ""]}
        active={1}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
      />,
    );
    const marker = screen.getByRole("button", { name: "Marker" });
    expect(marker).toHaveAttribute("aria-pressed", "true");
    expect(marker).toHaveAttribute("title", "Marker (⌥2)");
    // Unassigned (or missing) shortcut: just the name.
    expect(screen.getByRole("button", { name: "Brush" })).toHaveAttribute(
      "title",
      "Brush",
    );
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
  const api = {
    updateScene: vi.fn(),
    setActiveTool: vi.fn(),
    getAppState: vi.fn(() => state()),
  };
  const hook = renderHook(() => usePens({ current: api as any }, enabled));
  return { api, hook };
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

/** The app's dispatcher with only the pen handlers bound, a drawing open. */
const dispatcher = () =>
  renderHook(() =>
    useCommandDispatcher(document, window, {
      handlers: PEN_COMMAND_HANDLERS,
      app: { vaultOpen: true, drawingOpen: true, writable: true },
    }),
  );

describe("usePens", () => {
  it("selects a preset through the pen.selectN commands (Alt+digit)", () => {
    const { api, hook } = setup();
    const keys = dispatcher();

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
    // No sixth preset: claimed by the command but nothing happens.
    act(() => {
      PEN_COMMAND_HANDLERS["pen.select9"]?.();
    });
    expect(hook.result.current.active).toBe(1);
    // Option+digit types characters in text fields: never claimed there.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(altDigit("Digit1", input).defaultPrevented).toBe(false);
    input.remove();
    keys.unmount();
    hook.unmount();
    // Unmounted editor: the commands have no target any more.
    act(() => {
      PEN_COMMAND_HANDLERS["pen.select1"]?.();
    });
    expect(api.updateScene).toHaveBeenCalledTimes(1);
  });

  it("labels pens with their effective, rebindable shortcuts", () => {
    const platform = detectPlatform();
    const { hook } = setup();
    expect(hook.result.current.shortcuts[1]).toBe(
      formatChord("Alt+2", platform),
    );
    act(() =>
      updatePreferences({
        hotkeys: { "pen.select2": ["Alt+Shift+2"], "pen.select3": [] },
      }),
    );
    expect(hook.result.current.shortcuts[1]).toBe(
      formatChord("Alt+Shift+2", platform),
    );
    expect(hook.result.current.shortcuts[2]).toBe("");
    act(() => updatePreferences({ hotkeys: {} }));
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

  it("gives the editor its own look back when the pen tool is left", () => {
    const { api, hook } = setup();
    act(() => hook.result.current.onAppState(state()));
    act(() => hook.result.current.selectPen(4));
    const pen = {
      currentItemStrokeColor: "#ffd43b",
      currentItemOpacity: 40,
      currentItemStrokeVariability: "constant",
    };
    act(() => hook.result.current.onAppState(state(pen)));
    api.updateScene.mockClear();
    act(() =>
      hook.result.current.onAppState(
        state({ ...pen, activeTool: { type: "rectangle" } }),
      ),
    );
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({
        appState: {
          currentItemStrokeColor: "#1e1e1e",
          currentItemOpacity: 100,
          currentItemStrokeVariability: "variable",
        },
      }),
    );
    expect(hook.result.current.active).toBeNull();
  });

  it("leaves a colour picked by hand alone when the pen tool is left", () => {
    const { api, hook } = setup();
    act(() => hook.result.current.selectPen(3));
    api.updateScene.mockClear();
    const hand = { currentItemStrokeColor: "#000000" };
    act(() => hook.result.current.onAppState(state(hand)));
    act(() =>
      hook.result.current.onAppState(
        state({ ...hand, activeTool: { type: "rectangle" } }),
      ),
    );
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it("restores the editor base, not a styled tool's look, after a pen picked from that tool", () => {
    const { api, hook } = setup();
    api.getAppState.mockReturnValue(
      state({
        activeTool: { type: "arrow" },
        currentItemStrokeColor: "#f08c00",
      }),
    );
    act(() => hook.result.current.selectPen(4));
    const pen = {
      currentItemStrokeColor: "#ffd43b",
      currentItemOpacity: 40,
      currentItemStrokeVariability: "constant",
    };
    act(() => hook.result.current.onAppState(state(pen)));
    api.updateScene.mockClear();
    act(() =>
      hook.result.current.onAppState(
        state({ ...pen, activeTool: { type: "rectangle" } }),
      ),
    );
    expect(api.updateScene.mock.calls[0][0].appState).toMatchObject({
      currentItemStrokeColor: "#1e1e1e",
      currentItemOpacity: 100,
    });
  });

  it("keeps the pen applied when a pen is picked from another tool", () => {
    const { api, hook } = setup();
    act(() =>
      hook.result.current.onAppState(
        state({ activeTool: { type: "rectangle" } }),
      ),
    );
    act(() => hook.result.current.selectPen(3));
    api.updateScene.mockClear();
    act(() =>
      hook.result.current.onAppState(
        state({
          activeTool: { type: "rectangle" },
          currentItemStrokeColor: "#e03131",
          currentItemStrokeVariability: "constant",
        }),
      ),
    );
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(hook.result.current.active).toBe(3);
  });

  it("keeps stable getter identities and ignores selection when disabled", () => {
    const { api, hook } = setup(false);
    const { freedrawPen, laserPointerOptions } = hook.result.current;
    act(() => hook.result.current.onAppState(state()));
    hook.rerender();
    expect(hook.result.current.freedrawPen).toBe(freedrawPen);
    expect(hook.result.current.laserPointerOptions).toBe(laserPointerOptions);
    act(() => {
      PEN_COMMAND_HANDLERS["pen.select1"]?.();
    });
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(laserPointerOptions()).toHaveProperty("decayMs");
  });
});
