import { useSyncExternalStore } from "react";

import "./links.css";

import type { ModifierLinks } from "./modifierLinks";

/** Thin underline over the `[[span]]` under the pointer while the modifier is held. */
export function CmdHoverOverlay({ links }: { links: ModifierLinks }) {
  const hover = useSyncExternalStore(
    (cb) => links.subscribe(() => cb()),
    () => links.state,
  );
  if (!hover) {
    return null;
  }
  return (
    <>
      {hover.rects.map((r, i) => (
        <div
          key={i}
          className="vault-link-underline"
          style={{
            left: r.left,
            top: r.top,
            width: r.width,
            transform: r.angle ? `rotate(${r.angle}rad)` : undefined,
          }}
        />
      ))}
    </>
  );
}
