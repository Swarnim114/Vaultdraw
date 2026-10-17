/**
 * UI entry points for the graph view (navigator button, main menu, a
 * drawing's row menu). They only dispatch the existing graph commands, so
 * this module stays tiny and never pulls in the lazy graph chunk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GRAPH_COMMAND_IDS } from "../commands/graphCommands";

type Run = (id: string) => boolean;

interface Pending {
  path: string;
  /** The active drawing when the request was made. */
  from: string | null;
}

export interface GraphEntry {
  /** graph.open (toggles the graph view). */
  openGraph(): void;
  /**
   * The local graph centred on `path`. graph.openLocal works on the active
   * drawing, so another drawing is opened first and the command runs once it
   * is active. The request is dropped if the open fails or the user ends up
   * on a different drawing.
   */
  openLocalGraph(path: string): Promise<void>;
}

export function useGraphEntry(
  activePath: string | null,
  openDrawing: (path: string) => Promise<boolean>,
  run: Run,
): GraphEntry {
  const [pending, setPending] = useState<Pending | null>(null);
  const live = useRef({ activePath, openDrawing, run });
  live.current = { activePath, openDrawing, run };

  useEffect(() => {
    if (!pending) {
      return;
    }
    if (activePath === pending.path) {
      setPending(null);
      live.current.run(GRAPH_COMMAND_IDS.openLocal);
    } else if (activePath !== pending.from) {
      setPending(null);
    }
  }, [pending, activePath]);

  const openGraph = useCallback(() => {
    live.current.run(GRAPH_COMMAND_IDS.open);
  }, []);

  const openLocalGraph = useCallback(async (path: string) => {
    const { activePath: from, openDrawing: open, run: runNow } = live.current;
    if (path === from) {
      runNow(GRAPH_COMMAND_IDS.openLocal);
      return;
    }
    setPending({ path, from });
    if (!(await open(path))) {
      setPending(null);
    }
  }, []);

  return useMemo(
    () => ({ openGraph, openLocalGraph }),
    [openGraph, openLocalGraph],
  );
}
