import { describe, expect, it, vi } from "vitest";

import { TAB_COMMANDS } from "../commands/tabCommands";

import { buildTabHandlers } from "./tabHandlers";
import { createTabStore } from "./tabStore";

import type { TabsController } from "./tabController";

const setup = (ctrl: "mru" | "order" = "mru", stripVisible = true) => {
  const calls: string[] = [];
  const fn =
    (name: string) =>
    (...a: unknown[]) => {
      calls.push(`${name}${a.length ? `:${a.join(",")}` : ""}`);
      return Promise.resolve();
    };
  const controller = new Proxy({} as TabsController, {
    get: (_t, name: string) => fn(name),
  });
  const store = createTabStore();
  const copyPath = vi.fn();
  const emit = vi.fn();
  const revealInNavigator = vi.fn();
  const openPalette = vi.fn();
  const handlers = buildTabHandlers({
    controller,
    store,
    ctrlTab: () => ctrl,
    newTabPosition: () => "end",
    copyPath,
    toggleStrip: vi.fn(),
    signals: { emit, subscribe: () => () => {} },
    stripVisible: () => stripVisible,
    revealInNavigator,
    openPalette,
  });
  return {
    calls,
    handlers,
    store,
    copyPath,
    emit,
    revealInNavigator,
    openPalette,
  };
};

describe("buildTabHandlers", () => {
  it("binds every tab command except the ones the shell owns", () => {
    const { handlers } = setup();
    const unbound = TAB_COMMANDS.map((c) => c.id).filter((id) => !handlers[id]);
    expect(unbound.sort()).toEqual(["window.close"]);
  });

  it("goTo and ctrl+tab mode", () => {
    const a = setup("mru");
    void a.handlers["tabs.goTo3"]?.();
    void a.handlers["tabs.mruNext"]?.();
    expect(a.calls).toEqual(["goTo:3", "mruNext"]);
    const b = setup("order");
    void b.handlers["tabs.mruPrev"]?.();
    expect(b.calls).toEqual(["prev"]);
  });

  it("close targets the active tab; copyPath needs a drawing", () => {
    const a = setup();
    void a.handlers["tabs.close"]?.();
    expect(a.calls[0]).toMatch(/^closeWithShortcut:t/);
    void a.handlers["tabs.copyPath"]?.();
    expect(a.copyPath).not.toHaveBeenCalled();
  });

  it("showAll and focusStrip signal the strip", () => {
    const a = setup();
    void a.handlers["tabs.showAll"]?.();
    void a.handlers["tabs.focusStrip"]?.();
    expect(a.emit.mock.calls).toEqual([["showAll"], ["focus"]]);
    expect(a.openPalette).not.toHaveBeenCalled();
  });

  it("with the strip hidden, showAll opens the files palette and focusStrip does nothing", () => {
    const a = setup("mru", false);
    void a.handlers["tabs.showAll"]?.();
    void a.handlers["tabs.focusStrip"]?.();
    expect(a.openPalette).toHaveBeenCalledWith(false);
    expect(a.emit).not.toHaveBeenCalled();
  });

  it("file.openInNewTab opens the palette with the new-tab default", () => {
    const a = setup();
    void a.handlers["file.openInNewTab"]?.();
    expect(a.openPalette).toHaveBeenCalledWith(true);
  });

  it("reveal needs a drawing and passes the active path", () => {
    const a = setup();
    void a.handlers["tabs.reveal"]?.();
    expect(a.revealInNavigator).not.toHaveBeenCalled();
    a.store.update((s) => ({
      ...s,
      tabs: s.tabs.map((t) => ({ ...t, path: "x/y.excalidraw" })),
    }));
    void a.handlers["tabs.reveal"]?.();
    expect(a.revealInNavigator).toHaveBeenCalledWith("x/y.excalidraw");
  });
});
