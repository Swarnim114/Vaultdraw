import { describe, expect, it, vi } from "vitest";

import { TAB_COMMANDS } from "../commands/tabCommands";

import { buildTabHandlers } from "./tabHandlers";
import { createTabStore } from "./tabStore";

import type { TabsController } from "./tabController";

const setup = (ctrl: "mru" | "order" = "mru") => {
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
  const handlers = buildTabHandlers({
    controller,
    store,
    ctrlTab: () => ctrl,
    newTabPosition: () => "end",
    copyPath,
    toggleStrip: vi.fn(),
  });
  return { calls, handlers, store, copyPath };
};

describe("buildTabHandlers", () => {
  it("binds every tab command except the ones the shell owns", () => {
    const { handlers } = setup();
    const unbound = TAB_COMMANDS.map((c) => c.id).filter((id) => !handlers[id]);
    expect(unbound.sort()).toEqual(
      [
        "file.openInNewTab",
        "tabs.focusStrip",
        "tabs.reveal",
        "tabs.showAll",
        "window.close",
      ].sort(),
    );
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
});
