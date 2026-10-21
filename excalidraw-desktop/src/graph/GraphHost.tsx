/**
 * The always-loaded shell of the graph view: it registers the graph command
 * handlers and nothing else. The controller (open state, settings, view) is a
 * lazy chunk that is not requested until the first graph command runs (zero
 * cost when unused). Commands issued before it loads are queued and run once
 * it is ready.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { GRAPH_COMMAND_IDS } from "../commands/graphCommands";
import { registerCommandHandlers } from "../commands/handlerRegistry";

import type { OpenTarget } from "../tabs/types";
import type { GraphDispatch } from "./GraphHostInner";
import type { GraphSession, GraphSource } from "./GraphSession";
import type { GraphViewProps } from "./settings";
import type { InvokeFn } from "../vault/DesktopVaultRepository";

const GraphHostInner = lazy(() => import("./GraphHostInner"));

export interface GraphHostProps {
  /** Open vault handle; null closes the graph. */
  handle: string | null;
  currentPath: string | null;
  /** Changes when the app theme changes (colours are re-read). */
  themeKey: string;
  shortcutFor?: GraphViewProps["shortcutFor"];
  onOpenDrawing: (path: string, opts?: { target: OpenTarget }) => unknown;
  /** The editor is hidden and frozen while this is true. */
  onOpenChange: (open: boolean) => void;
  /** Called after the graph closed: give focus back to the canvas. */
  onClosed: () => void;
  /** Tests: settings.toml transport. */
  invoke?: InvokeFn;
  /** Tests / e2e: a fake graph source instead of the native `vault_graph`. */
  graphSource?: GraphSource;
  /** Tests / e2e: receives the live session once ready (null on close). */
  onSession?: (session: GraphSession | null) => void;
}

export function GraphHost(props: GraphHostProps) {
  const [loaded, setLoaded] = useState(false);
  const dispatch = useRef<GraphDispatch | null>(null);
  const queue = useRef<Array<() => void>>([]);
  const hasHandle = useRef(false);
  hasHandle.current = props.handle !== null;

  const bind = useCallback((next: GraphDispatch | null) => {
    dispatch.current = next;
    if (next) {
      queue.current.splice(0).forEach((run) => run());
    }
  }, []);

  useEffect(
    () =>
      registerCommandHandlers(
        Object.fromEntries(
          Object.values(GRAPH_COMMAND_IDS).map((id) => [
            id,
            () => {
              if (dispatch.current) {
                return dispatch.current(id);
              }
              if (!hasHandle.current) {
                return undefined;
              }
              setLoaded(true);
              queue.current.push(() => dispatch.current?.(id));
              return undefined;
            },
          ]),
        ),
      ),
    [],
  );

  return loaded ? (
    <Suspense fallback={null}>
      <GraphHostInner {...props} bind={bind} />
    </Suspense>
  ) : null;
}
