// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  installNativeContextMenuSuppression,
  isEditableTarget,
  shouldSuppressNativeMenu,
} from "./nativeContextMenu";

const base = {
  enabled: true,
  defaultPrevented: false,
  editable: false,
  onSelection: false,
};

describe("shouldSuppressNativeMenu", () => {
  it("suppresses on a plain, unhandled target in release", () => {
    expect(shouldSuppressNativeMenu(base)).toBe(true);
  });
  it("leaves dev builds alone", () => {
    expect(shouldSuppressNativeMenu({ ...base, enabled: false })).toBe(false);
  });
  it("leaves events the app already handled", () => {
    expect(shouldSuppressNativeMenu({ ...base, defaultPrevented: true })).toBe(
      false,
    );
  });
  it("keeps the native menu for editable targets and selections", () => {
    expect(shouldSuppressNativeMenu({ ...base, editable: true })).toBe(false);
    expect(shouldSuppressNativeMenu({ ...base, onSelection: true })).toBe(
      false,
    );
  });
});

describe("isEditableTarget", () => {
  it("recognises inputs, textareas and contenteditable (and descendants)", () => {
    document.body.innerHTML = `<input id="i"><textarea id="t"></textarea>
      <div contenteditable="true"><span id="c">x</span></div><div id="p">y</div>`;
    const el = (id: string) => document.getElementById(id);
    expect(isEditableTarget(el("i"))).toBe(true);
    expect(isEditableTarget(el("t"))).toBe(true);
    expect(isEditableTarget(el("c"))).toBe(true);
    expect(isEditableTarget(el("p"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("installNativeContextMenuSuppression", () => {
  const fire = (target: Element) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };

  it("prevents the default on plain areas, not in editable fields", () => {
    document.body.innerHTML = `<div id="p">y</div><input id="i">`;
    const uninstall = installNativeContextMenuSuppression(window, true);
    expect(fire(document.getElementById("p")!).defaultPrevented).toBe(true);
    expect(fire(document.getElementById("i")!).defaultPrevented).toBe(false);
    uninstall();
    expect(fire(document.getElementById("p")!).defaultPrevented).toBe(false);
  });

  it("does nothing when disabled", () => {
    document.body.innerHTML = `<div id="p">y</div>`;
    installNativeContextMenuSuppression(window, false)();
    expect(fire(document.getElementById("p")!).defaultPrevented).toBe(false);
  });

  it("runs after app handlers and does not stop propagation", () => {
    document.body.innerHTML = `<div id="root"><div id="p">y</div></div>`;
    const order: string[] = [];
    document.getElementById("root")!.addEventListener("contextmenu", (e) => {
      order.push("app");
      e.preventDefault();
    });
    const uninstall = installNativeContextMenuSuppression(window, true);
    window.addEventListener("contextmenu", () => order.push("after"), {
      once: true,
    });
    const event = fire(document.getElementById("p")!);
    expect(order).toEqual(["app", "after"]);
    expect(event.defaultPrevented).toBe(true);
    uninstall();
  });
});
