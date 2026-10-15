import { useEffect, useMemo } from "react";

import { ModifierLinks } from "./modifierLinks";

import type { ModifierLinksDeps } from "./modifierLinks";

/** Creates the modifier+click controller for `container` and runs it while mounted. */
export function useModifierLinks(
  container: HTMLElement | null,
  deps: Omit<ModifierLinksDeps, "container">,
): ModifierLinks | null {
  const controller = useMemo(
    () => (container ? new ModifierLinks({ ...deps, container }) : null),
    // deps are getters over refs: stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [container],
  );
  useEffect(() => {
    controller?.start();
    return () => controller?.stop();
  }, [controller]);
  return controller;
}
