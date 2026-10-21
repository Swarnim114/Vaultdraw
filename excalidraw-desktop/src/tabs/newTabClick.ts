/**
 * Opening rules (tabs PLAN §3): Cmd/Ctrl+click and middle click open a drawing
 * in a new tab; a plain click uses the current one. One helper so the tree,
 * search results and graph agree.
 */
import type { OpenTarget } from "./types";

type ModifierEvent = { metaKey: boolean; ctrlKey: boolean };

export const isNewTabClick = (e: ModifierEvent): boolean =>
  e.metaKey || e.ctrlKey;

/** The open target for a click-like event; undefined = the default rule. */
export const clickTarget = (e: ModifierEvent): OpenTarget | undefined =>
  isNewTabClick(e) ? "new" : undefined;
