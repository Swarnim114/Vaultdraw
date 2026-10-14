import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "./commands";
import { readContext } from "./context";
import {
  installCommandDispatcher,
  isDispatcherPaused,
  pauseDispatcher,
} from "./dispatcher";
import { buildKeymap } from "./keymap";

import type { CommandHandler } from "./types";

const app = { vaultOpen: true, drawingOpen: true, writable: true };

interface Setup {
  handlers: Record<string, CommandHandler>;
  overrides?: Record<string, string[]>;
  appState?: typeof app;
}

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const install = ({ handlers, overrides = {}, appState = app }: Setup) => {
  const keymap = buildKeymap(COMMANDS, overrides, "mac");
  dispose = installCommandDispatcher(window, {
    platform: "mac",
    getKeymap: () => keymap,
    getContext: () => readContext(document, appState),
    getHandler: (id) => handlers[id],
  });
};

const press = (
  init: KeyboardEventInit,
  target: EventTarget = document.body,
) => {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
};
const cmdN = { code: "KeyN", key: "n", metaKey: true };

describe("dispatcher", () => {
  let docListener: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    docListener = vi.fn();
    document.addEventListener("keydown", docListener);
  });
  afterEach(() => document.removeEventListener("keydown", docListener));

  it("claims a bound, available key: handler runs, event stopped", () => {
    const handler = vi.fn();
    install({ handlers: { "vault.newDrawing": handler } });
    const e = press(cmdN);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(docListener).not.toHaveBeenCalled();
  });

  it("leaves unbound keys alone", () => {
    const handler = vi.fn();
    install({ handlers: { "vault.newDrawing": handler } });
    const e = press({ code: "KeyZ", key: "z", metaKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(docListener).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves bound keys alone without a handler or when `when` fails", () => {
    install({ handlers: {} });
    expect(press(cmdN).defaultPrevented).toBe(false);
    dispose?.();
    const handler = vi.fn();
    install({
      handlers: { "vault.newDrawing": handler },
      appState: { ...app, writable: false },
    });
    expect(press(cmdN).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(docListener).toHaveBeenCalledTimes(2);
  });

  it("skips to the next candidate that has a handler", () => {
    const second = vi.fn();
    install({
      handlers: { "file.duplicate": second },
      overrides: { "file.duplicate": ["Mod+N"] },
    });
    press(cmdN);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not fire while a modal is open", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="vault-modal-backdrop"></div>`,
    );
    const handler = vi.fn();
    install({ handlers: { "vault.newDrawing": handler } });
    expect(press(cmdN).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("modifier-free chords never fire while text editing", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<input id="i"><textarea id="t"></textarea><div id="c" contenteditable="true" tabindex="0"></div>`,
    );
    const handler = vi.fn();
    install({
      handlers: { "vault.newDrawing": handler },
      overrides: { "vault.newDrawing": ["N", "Shift+M"] },
    });
    for (const id of ["i", "t", "c"]) {
      (document.getElementById(id) as HTMLElement).focus();
      const active = document.activeElement as Element;
      expect(press({ code: "KeyN", key: "n" }, active).defaultPrevented).toBe(
        false,
      );
      expect(
        press({ code: "KeyM", key: "M", shiftKey: true }, active)
          .defaultPrevented,
      ).toBe(false);
    }
    expect(handler).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement).blur();
    expect(press({ code: "KeyN", key: "n" }).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("modifier chords still fire while text editing", () => {
    document.body.insertAdjacentHTML("beforeend", `<input id="i">`);
    (document.getElementById("i") as HTMLElement).focus();
    const handler = vi.fn();
    install({ handlers: { "vault.newDrawing": handler } });
    press(cmdN, document.activeElement as Element);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("passThrough: prevents default, lets the event propagate, runs later", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    install({ handlers: { "file.save": save } });
    const e = press({ code: "KeyS", key: "s", metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(docListener).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("works for synthetic events without a code", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    install({ handlers: { "file.save": save } });
    press({ key: "s", metaKey: true, ctrlKey: true });
    vi.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("pause is ref-counted", () => {
    const handler = vi.fn();
    install({ handlers: { "vault.newDrawing": handler } });
    const a = pauseDispatcher();
    const b = pauseDispatcher();
    expect(isDispatcherPaused()).toBe(true);
    expect(press(cmdN).defaultPrevented).toBe(false);
    a();
    a();
    expect(isDispatcherPaused()).toBe(true);
    b();
    expect(isDispatcherPaused()).toBe(false);
    expect(press(cmdN).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores IME composition, keyCode 229 and modifier-only presses", () => {
    const handler = vi.fn();
    install({ handlers: { "vault.newDrawing": handler } });
    expect(press({ ...cmdN, isComposing: true }).defaultPrevented).toBe(false);
    expect(press({ ...cmdN, keyCode: 229 }).defaultPrevented).toBe(false);
    expect(
      press({ code: "MetaLeft", key: "Meta", metaKey: true }).defaultPrevented,
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("survives throwing and rejecting handlers", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ok = vi.fn();
    install({
      handlers: {
        "vault.newDrawing": () => {
          throw new Error("boom");
        },
        "view.toggleNavigator": () => Promise.reject(new Error("async boom")),
        "settings.open": ok,
      },
    });
    press(cmdN);
    press({ code: "Backslash", key: "\\", metaKey: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(err).toHaveBeenCalledTimes(2);
    press({ code: "Comma", key: ",", metaKey: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("removes its listener on dispose", () => {
    const handler = vi.fn();
    install({ handlers: { "vault.newDrawing": handler } });
    dispose?.();
    dispose = null;
    press(cmdN);
    expect(handler).not.toHaveBeenCalled();
  });
});
