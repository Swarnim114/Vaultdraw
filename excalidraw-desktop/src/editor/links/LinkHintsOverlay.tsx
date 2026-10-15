import { useSyncExternalStore } from "react";

import "./links.css";

import type { LinkHints as LinkHintsController } from "./linkHints";

/** The hint badges drawn while hint mode is active. */
export function LinkHintsOverlay({ hints }: { hints: LinkHintsController }) {
  const state = useSyncExternalStore(
    (cb) => hints.subscribe(() => cb()),
    () => hints.state,
  );
  if (!state) {
    return null;
  }
  const { typed } = state;
  return (
    <div aria-hidden="true">
      {state.hints
        .filter((h) => h.label.startsWith(typed))
        .map((h) => (
          <span
            key={`${h.elementId}:${h.raw}:${h.label}`}
            className="vault-link-hint"
            style={{ left: h.x, top: h.y }}
          >
            <span className="vault-link-hint__typed">
              {h.label.slice(0, typed.length)}
            </span>
            {h.label.slice(typed.length)}
          </span>
        ))}
    </div>
  );
}
