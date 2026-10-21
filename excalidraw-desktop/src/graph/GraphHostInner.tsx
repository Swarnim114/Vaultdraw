/**
 * The graph controller: open state, per-vault settings persistence and the
 * command logic. Lazy (loaded by GraphHost on the first graph command).
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { GRAPH_COMMAND_IDS as ID } from "../commands/graphCommands";

import GraphView from "./GraphView";

import type { GraphSettingsSaver } from "./graphSettingsStore";
import type { GraphHostProps } from "./GraphHost";
import type { GraphMode, GraphSettings } from "./settings";

// The chunk's stylesheet is not loaded yet, so the placeholder styles itself.
const LOADING_STYLE = {
  position: "absolute",
  inset: 0,
  background: "var(--vault-bg, #fff)",
  zIndex: 5,
} as const;

// The store pulls in the force defaults (barnesHut), so it loads with the view, not with the app.
const loadStore = () => import("./graphSettingsStore");

export type GraphDispatch = (id: string) => void | Promise<void>;

export interface GraphHostInnerProps extends GraphHostProps {
  /** Hands the shell the command dispatcher (null on unmount). */
  bind: (dispatch: GraphDispatch | null) => void;
}

type Flag = "showOrphans" | "showTags" | "showUnresolved";

export default function GraphHostInner({
  handle,
  currentPath,
  themeKey,
  shortcutFor,
  onOpenDrawing,
  onOpenChange,
  onClosed,
  invoke,
  graphSource,
  onSession,
  bind,
}: GraphHostInnerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GraphMode>("global");
  const [fitNonce, setFitNonce] = useState(0);
  const [settings, setSettings] = useState<GraphSettings | null>(null);
  const settingsRef = useRef<GraphSettings | null>(null);
  const saver = useRef<GraphSettingsSaver | null>(null);
  const loading = useRef<Promise<GraphSettings> | null>(null);
  const live = useRef({ handle, currentPath, onOpenDrawing, onClosed });
  live.current = { handle, currentPath, onOpenDrawing, onClosed };

  const commit = useCallback((next: GraphSettings) => {
    settingsRef.current = next;
    setSettings(next);
    saver.current?.save(next);
  }, []);

  /** Settings are read on the first open of a vault, never at startup. */
  const ensureLoaded = useCallback(() => {
    const h = live.current.handle;
    loading.current ??= loadStore().then(async (store) => {
      const loaded = await store.loadGraphSettings(h ?? "", invoke);
      if (live.current.handle === h) {
        settingsRef.current = loaded;
        setSettings(loaded);
        saver.current = store.createGraphSettingsSaver(h ?? "", loaded, invoke);
      }
      return loaded;
    });
    return loading.current;
  }, [invoke]);

  // A different vault: flush the old settings and forget everything.
  useEffect(
    () => () => {
      void saver.current?.flush();
      saver.current = null;
      loading.current = null;
      settingsRef.current = null;
      setSettings(null);
      setOpen(false);
      setMode("global");
    },
    [handle],
  );

  const show = useCallback(
    async (nextMode?: GraphMode) => {
      if (!live.current.handle) {
        return;
      }
      await ensureLoaded();
      if (nextMode) {
        setMode(nextMode);
      }
      setOpen(true);
    },
    [ensureLoaded],
  );

  const close = useCallback(() => {
    setOpen(false);
    live.current.onClosed();
  }, []);

  const openedBefore = useRef(false);
  useEffect(() => {
    if (open || openedBefore.current) {
      openedBefore.current = open;
      onOpenChange(open);
    }
  }, [open, onOpenChange]);

  useEffect(() => {
    const toggle = (flag: Flag) => async () => {
      await show();
      const current = settingsRef.current;
      if (current) {
        commit({ ...current, [flag]: !current[flag] });
      }
    };
    const handlers: Record<string, () => void | Promise<void>> = {
      [ID.open]: () => (open ? close() : show("global")),
      [ID.openLocal]: () =>
        live.current.currentPath ? show("local") : undefined,
      [ID.toggleOrphans]: toggle("showOrphans"),
      [ID.toggleTags]: toggle("showTags"),
      [ID.toggleUnresolved]: toggle("showUnresolved"),
      [ID.fit]: async () => {
        await show();
        setFitNonce((n) => n + 1);
      },
    };
    bind((id) => handlers[id]?.());
  }, [open, show, close, commit, bind]);
  useEffect(() => () => bind(null), [bind]);

  if (!open || !handle || !settings) {
    return null;
  }
  return (
    <Suspense
      fallback={
        <div className="vd-graph" style={LOADING_STYLE} aria-busy="true" />
      }
    >
      <GraphView
        handle={handle}
        currentPath={currentPath}
        mode={mode}
        onModeChange={setMode}
        settings={settings}
        onSettingsChange={commit}
        onOpen={(path, target) => {
          setOpen(false);
          void live.current.onOpenDrawing(
            path,
            target ? { target } : undefined,
          );
        }}
        onClose={close}
        shortcutFor={shortcutFor}
        themeKey={themeKey}
        fitNonce={fitNonce}
        source={graphSource}
        onSession={onSession}
      />
    </Suspense>
  );
}
