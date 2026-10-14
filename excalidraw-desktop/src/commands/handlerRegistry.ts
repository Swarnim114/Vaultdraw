/**
 * Command handlers bound by components other than the app shell (the open
 * editor binds paper, library and canvas commands here). The shell's own
 * handlers (useAppCommands) win when both bind an id.
 */
import type { CommandHandler, CommandHandlers } from "./types";

const layers: CommandHandlers[] = [];

/** Bind `handlers` until the returned function is called. */
export function registerCommandHandlers(handlers: CommandHandlers): () => void {
  layers.push(handlers);
  return () => {
    const i = layers.lastIndexOf(handlers);
    if (i >= 0) {
      layers.splice(i, 1);
    }
  };
}

/** The most recently registered handler for `id`. */
export function getRegisteredHandler(id: string): CommandHandler | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const handler = layers[i][id];
    if (handler) {
      return handler;
    }
  }
  return undefined;
}
