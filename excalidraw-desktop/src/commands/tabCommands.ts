/**
 * Tab commands. Handlers are bound by the tabs host; a command without one is
 * simply not offered. Defaults follow browser conventions (Cmd/Ctrl+T, W, 1-9,
 * Ctrl+Tab for the last-used tab); the rest have no default key.
 */
import type { CommandDefinition } from "./types";

export const TAB_COMMAND_IDS = {
  new: "tabs.new",
  close: "tabs.close",
  closeOthers: "tabs.closeOthers",
  closeRight: "tabs.closeRight",
  closeAll: "tabs.closeAll",
  reopenClosed: "tabs.reopenClosed",
  next: "tabs.next",
  prev: "tabs.prev",
  mruNext: "tabs.mruNext",
  mruPrev: "tabs.mruPrev",
  goTo1: "tabs.goTo1",
  goTo2: "tabs.goTo2",
  goTo3: "tabs.goTo3",
  goTo4: "tabs.goTo4",
  goTo5: "tabs.goTo5",
  goTo6: "tabs.goTo6",
  goTo7: "tabs.goTo7",
  goTo8: "tabs.goTo8",
  goToLast: "tabs.goToLast",
  togglePin: "tabs.togglePin",
  moveLeft: "tabs.moveLeft",
  moveRight: "tabs.moveRight",
  showAll: "tabs.showAll",
  focusStrip: "tabs.focusStrip",
  copyPath: "tabs.copyPath",
  reveal: "tabs.reveal",
  toggleStrip: "tabs.toggleStrip",
  openInNewTab: "file.openInNewTab",
  closeWindow: "window.close",
} as const;

const I = TAB_COMMAND_IDS;

const VAULT = ["vaultOpen", "!modalOpen"] as const;
const DRAWING = ["drawingOpen", "!modalOpen"] as const;

interface Keys {
  mac?: string[];
  other?: string[];
}

const make = (
  id: string,
  title: string,
  category: CommandDefinition["category"],
  keys: Keys,
  when: CommandDefinition["when"],
): CommandDefinition => ({
  id,
  title,
  category,
  keys: { default: keys.other ?? [], mac: keys.mac ?? keys.other ?? [] },
  when,
});

const tab = (
  id: string,
  title: string,
  keys: Keys,
  when: CommandDefinition["when"] = [...VAULT],
) => make(id, `Tabs: ${title}`, "Tabs", keys, when);

const same = (...chords: string[]): Keys => ({ other: chords });
const NONE: Keys = {};

const goTo = (id: string, n: number | "last"): CommandDefinition =>
  tab(
    id,
    n === "last" ? "Go to last tab" : `Go to tab ${n}`,
    same(`Mod+${n === "last" ? 9 : n}`),
  );

export const TAB_COMMANDS: CommandDefinition[] = [
  tab(I.new, "New tab", same("Mod+T")),
  tab(I.close, "Close tab", same("Mod+W"), [...VAULT]),
  tab(I.closeOthers, "Close other tabs", NONE, [...VAULT]),
  tab(I.closeRight, "Close tabs to the right", NONE, [...VAULT]),
  tab(I.closeAll, "Close all tabs", NONE, [...VAULT]),
  tab(I.reopenClosed, "Reopen closed tab", same("Mod+Shift+T")),
  tab(I.next, "Next tab", {
    mac: ["Mod+Shift+BracketRight", "Ctrl+PageDown"],
    other: ["Mod+PageDown"],
  }),
  tab(I.prev, "Previous tab", {
    mac: ["Mod+Shift+BracketLeft", "Ctrl+PageUp"],
    other: ["Mod+PageUp"],
  }),
  tab(I.mruNext, "Switch to recent tab", same("Ctrl+Tab")),
  tab(I.mruPrev, "Switch to previous recent tab", same("Ctrl+Shift+Tab")),
  goTo(I.goTo1, 1),
  goTo(I.goTo2, 2),
  goTo(I.goTo3, 3),
  goTo(I.goTo4, 4),
  goTo(I.goTo5, 5),
  goTo(I.goTo6, 6),
  goTo(I.goTo7, 7),
  goTo(I.goTo8, 8),
  goTo(I.goToLast, "last"),
  tab(I.togglePin, "Pin or unpin tab", NONE, [...DRAWING]),
  tab(I.moveLeft, "Move tab left", same("Mod+Alt+Shift+BracketLeft"), [
    ...DRAWING,
  ]),
  tab(I.moveRight, "Move tab right", same("Mod+Alt+Shift+BracketRight"), [
    ...DRAWING,
  ]),
  tab(I.showAll, "Show open tabs", same("Mod+Shift+A")),
  tab(I.focusStrip, "Focus tab strip", NONE),
  tab(I.copyPath, "Copy path", NONE, [...DRAWING]),
  tab(I.reveal, "Reveal in navigator", NONE, [...DRAWING]),
  tab(I.toggleStrip, "Show or hide tab strip", NONE),
  tab(I.openInNewTab, "Open drawing in new tab…", NONE),
  make(
    I.closeWindow,
    "Window: Close window",
    "Tabs",
    // macOS: the app menu owns Cmd+Shift+W (reserved), so no registry key.
    { mac: [], other: ["Mod+Shift+W"] },
    undefined,
  ),
];
