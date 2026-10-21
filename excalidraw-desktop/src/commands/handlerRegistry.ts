/**
 * Command handlers bound by components other than the app shell (the open
 * editor binds paper, library and canvas commands here). The shell's own
 * handlers (useAppCommands) win when both bind an id.
 */
import type { CommandHandler, CommandHandlers } from "./types";

const layers: CommandHandlers[] = [];
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Notified whenever a layer is bound or unbound (for UI that lists what is offered). */
export function subscribeCommandHandlers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bumps on every bind/unbind: a cheap snapshot for useSyncExternalStore. */
export const commandHandlersVersion = (): number => version;

/** Bind `handlers` until the returned function is called. */
export function registerCommandHandlers(handlers: CommandHandlers): () => void {
  layers.push(handlers);
  changed();
  return () => {
    const i = layers.lastIndexOf(handlers);
    if (i >= 0) {
      layers.splice(i, 1);
      changed();
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
  return prefixHandlerFor(id);
}

const prefixLayers: {
  prefix: string;
  run: (rest: string) => void | Promise<void>;
}[] = [];

/**
 * Bind every id starting with `prefix` (e.g. "drawing.open:") to `run`, which
 * gets the rest of the id. Exact handlers win. Returns the unbind function.
 */
export function registerCommandPrefixHandler(
  prefix: string,
  run: (rest: string) => void | Promise<void>,
): () => void {
  const layer = { prefix, run };
  prefixLayers.push(layer);
  return () => {
    const i = prefixLayers.lastIndexOf(layer);
    if (i >= 0) {
      prefixLayers.splice(i, 1);
    }
  };
}

const prefixHandlerFor = (id: string): CommandHandler | undefined => {
  for (let i = prefixLayers.length - 1; i >= 0; i--) {
    const { prefix, run } = prefixLayers[i];
    if (id.startsWith(prefix) && id.length > prefix.length) {
      return () => run(id.slice(prefix.length));
    }
  }
  return undefined;
};
