/**
 * Runs an action on a given drawing for UI entry points whose command works on
 * the active drawing (a row menu's "Open local graph", "History"). Another
 * drawing is opened first and the action runs once it is active. The request
 * is dropped if the open fails or the user ends up on a different drawing.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Pending {
  path: string;
  /** The active drawing when the request was made. */
  from: string | null;
  action: () => void;
}

export function useRunOnDrawing(
  activePath: string | null,
  openDrawing: (path: string) => Promise<boolean>,
): (path: string, action: () => void) => Promise<void> {
  const [pending, setPending] = useState<Pending | null>(null);
  const live = useRef({ activePath, openDrawing });
  live.current = { activePath, openDrawing };

  useEffect(() => {
    if (!pending) {
      return;
    }
    if (activePath === pending.path) {
      setPending(null);
      pending.action();
    } else if (activePath !== pending.from) {
      setPending(null);
    }
  }, [pending, activePath]);

  return useCallback(async (path: string, action: () => void) => {
    const { activePath: from, openDrawing: open } = live.current;
    if (path === from) {
      action();
      return;
    }
    setPending({ path, from, action });
    if (!(await open(path))) {
      setPending(null);
    }
  }, []);
}
