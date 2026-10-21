/**
 * Tabs: one-way signals from commands to the strip UI (show the tab list,
 * focus the strip). Tiny pub/sub, created once per runtime in useTabs.
 */

export type StripSignalKind = "showAll" | "focus";

export type StripSignals = {
  emit(kind: StripSignalKind): void;
  subscribe(fn: (kind: StripSignalKind) => void): () => void;
};

export const createStripSignals = (): StripSignals => {
  const listeners = new Set<(kind: StripSignalKind) => void>();
  return {
    emit: (kind) => listeners.forEach((fn) => fn(kind)),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
