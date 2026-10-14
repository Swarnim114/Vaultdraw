/**
 * Binds the "pen.selectN" commands (commands.ts) to the open editor's pens.
 * The editor registers its selector on mount; one editor per window.
 */
import { penCommandId } from "../commands/commands";

import { MAX_PEN_PRESETS } from "./penPresets";

import type { CommandHandlers } from "../commands/types";

type PenSelector = (index: number) => void;

let selector: PenSelector | null = null;

/** Make `select` the target of the pen commands; returns the unregister. */
export function registerPenSelector(select: PenSelector): () => void {
  selector = select;
  return () => {
    if (selector === select) {
      selector = null;
    }
  };
}

export const PEN_COMMAND_HANDLERS: CommandHandlers = Object.fromEntries(
  Array.from({ length: MAX_PEN_PRESETS }, (_, i) => [
    penCommandId(i),
    () => selector?.(i),
  ]),
);
