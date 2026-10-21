/**
 * Tabs (F5): command handlers for TAB_COMMANDS, bound to a controller. Pure
 * wiring (no React), so it is unit-testable with a fake controller.
 */
import { TAB_COMMAND_IDS as T } from "../commands/tabCommands";

import { getActiveTab } from "./tabsModel";

import type { CommandHandlers } from "../commands/types";
import type { TabsController } from "./tabController";
import type { TabStore } from "./tabStore";
import type { NewTabPosition } from "./types";

export type TabHandlerContext = {
  controller: TabsController;
  store: TabStore;
  ctrlTab: () => "mru" | "order";
  newTabPosition: () => NewTabPosition;
  copyPath: (path: string) => void;
  toggleStrip: () => void;
};

const GO_TO = [
  T.goTo1,
  T.goTo2,
  T.goTo3,
  T.goTo4,
  T.goTo5,
  T.goTo6,
  T.goTo7,
  T.goTo8,
];

export function buildTabHandlers(ctx: TabHandlerContext): CommandHandlers {
  const { controller: c, store } = ctx;
  const active = () => getActiveTab(store.getState());
  const mru = (dir: "next" | "prev") =>
    ctx.ctrlTab() === "order"
      ? dir === "next"
        ? c.next()
        : c.prev()
      : dir === "next"
      ? c.mruNext()
      : c.mruPrev();
  const onActivePath = (run: (path: string) => void) => () => {
    const { path } = active();
    if (path) {
      run(path);
    }
  };
  return {
    [T.new]: () => c.newTab(ctx.newTabPosition()),
    [T.close]: () => c.closeWithShortcut(active().id),
    [T.closeOthers]: () => c.closeOthers(active().id),
    [T.closeRight]: () => c.closeRight(active().id),
    [T.closeAll]: () => c.closeAll(),
    [T.reopenClosed]: () => c.reopenClosed(),
    [T.next]: () => c.next(),
    [T.prev]: () => c.prev(),
    [T.mruNext]: () => mru("next"),
    [T.mruPrev]: () => mru("prev"),
    ...Object.fromEntries(GO_TO.map((id, i) => [id, () => c.goTo(i + 1)])),
    [T.goToLast]: () => c.goToLast(),
    [T.togglePin]: () => c.togglePin(active().id),
    [T.moveLeft]: () => c.moveBy(active().id, -1),
    [T.moveRight]: () => c.moveBy(active().id, 1),
    [T.copyPath]: onActivePath(ctx.copyPath),
    [T.toggleStrip]: ctx.toggleStrip,
  };
}
