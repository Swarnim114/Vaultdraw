/**
 * The always-loaded part of the graph view: command handlers, open state,
 * per-vault settings persistence. The view itself is a lazy chunk that is
 * not requested until the graph is first opened (zero cost when unused).
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { GRAPH_COMMAND_IDS as ID } from "../commands/graphCommands";

import {
  createGraphSettingsSaver,
  freshGraphSettings,
  loadGraphSettings,
  type GraphSettingsSaver,
} from "./graphSettingsStore";

import type { InvokeFn } from "../vault/DesktopVaultRepository";
import type { GraphMode, GraphSettings, GraphViewProps } from "./settings";

// The chunk's stylesheet is not loaded yet, so the placeholder styles itself.
const LOADING_STYLE = {
  position: "absolute",
  inset: 0,
  background: "var(--vault-bg, #fff)",
  zIndex: 5,
} as const;

const GraphView = lazy(() => import("./GraphView"));

export interface GraphHostProps {
  /** Open vault handle; null closes the graph. */
  handle: string | null;
  currentPath: string | null;
  /** Changes when the app theme changes (colours are re-read). */
  themeKey: string;
  shortcutFor?: GraphViewProps["shortcutFor"];
  onOpenDrawing: (path: string) => void | Promise<void>;
  /** The editor is hidden and frozen while this is true. */
  onOpenChange: (open: boolean) => void;
  /** Called after the graph closed: give focus back to the canvas. */
  onClosed: () => void;
  /** Tests: settings.toml transport. */
  invoke?: InvokeFn;
}

type Flag = "showOrphans" | "showTags" | "showUnresolved";

export function GraphHost({
  handle,
  currentPath,
  themeKey,
  shortcutFor,
  onOpenDrawing,
  onOpenChange,
  onClosed,
  invoke,
}: GraphHostProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GraphMode>("global");
  const [settings, setSettings] = useState<GraphSettings>(freshGraphSettings);
  const settingsRef = useRef(settings);
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
    if (!h) {
      return Promise.resolve(settingsRef.current);
    }
    loading.current ??= loadGraphSettings(h, invoke).then((loaded) => {
      if (live.current.handle === h) {
        settingsRef.current = loaded;
        setSettings(loaded);
        saver.current = createGraphSettingsSaver(h, loaded, invoke);
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
      settingsRef.current = freshGraphSettings();
      setSettings(settingsRef.current);
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
      commit({ ...settingsRef.current, [flag]: !settingsRef.current[flag] });
    };
    return registerCommandHandlers({
      [ID.open]: () => (open ? close() : show("global")),
      [ID.openLocal]: () =>
        live.current.currentPath ? show("local") : undefined,
      [ID.toggleOrphans]: toggle("showOrphans"),
      [ID.toggleTags]: toggle("showTags"),
      [ID.toggleUnresolved]: toggle("showUnresolved"),
      [ID.fit]: async () => {
        await show();
        // The view's own "fit" key (0); it bubbles to the view's key handler.
        requestAnimationFrame(() =>
          document
            .querySelector(".vd-graph")
            ?.dispatchEvent(
              new KeyboardEvent("keydown", { key: "0", bubbles: true }),
            ),
        );
      },
    });
  }, [open, show, close, commit]);

  if (!open || !handle) {
    return null;
  }
  return (
    <Suspense fallback={<div className="vd-graph" style={LOADING_STYLE} aria-busy="true" />}>
      <GraphView
        handle={handle}
        currentPath={currentPath}
        mode={mode}
        onModeChange={setMode}
        settings={settings}
        onSettingsChange={commit}
        onOpen={(path) => {
          setOpen(false);
          void live.current.onOpenDrawing(path);
        }}
        onClose={close}
        shortcutFor={shortcutFor}
        themeKey={themeKey}
      />
    </Suspense>
  );
}
