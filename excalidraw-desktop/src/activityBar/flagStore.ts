/**
 * A one-boolean external store: `publish` notifies subscribers only when the
 * value flips, so a panel's open state can drive a pressed button without
 * re-rendering the component that owns the panel.
 */
export interface FlagStore {
  get(): boolean;
  publish(value: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createFlagStore(initial = false): FlagStore {
  let value = initial;
  const listeners = new Set<() => void>();
  const get = () => value;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get,
    subscribe,
    publish(next) {
      if (value !== next) {
        value = next;
        listeners.forEach((l) => l());
      }
    },
  };
}
