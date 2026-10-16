/**
 * The graph view (lazy chunk): toolbar, stage with the GPU canvas and the label overlay, hover
 * card, hint badges and the Vim key handling. All engine work lives in GraphSession.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DesktopVaultGraph } from "./DesktopVaultGraph";
import { type GraphSession, type GraphSource } from "./GraphSession";
import { GraphToolbar } from "./GraphToolbar";
import { HoverCard } from "./HoverCard";
import { resolveHint, type HintMap } from "./hints";
import { actionForKey } from "./keyboard";
import { SettingsPanel } from "./SettingsPanel";
import { useGraphSession } from "./useGraphSession";

import "./graph.css";

import type { GraphViewProps } from "./settings";

export interface GraphViewExtraProps {
  /** Tests / e2e: a fake graph source (default: the native vault graph). */
  source?: GraphSource;
  /** Tests / e2e: skip WebGL. */
  forceCanvas2d?: boolean;
  /** Tests / e2e: receives the live session once the graph is ready (null on close). */
  onSession?: (session: GraphSession | null) => void;
}

type HintState = {
  map: HintMap;
  typed: string;
  at: Map<number, { x: number; y: number }>;
};

const ZOOM_STEP = 1.25;

const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export default function GraphView(props: GraphViewProps & GraphViewExtraProps) {
  const { settings, mode, onClose, onOpen } = props;
  const defaultSource = useMemo(() => new DesktopVaultGraph(), []);
  const source = props.source ?? defaultSource;
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [hints, setHints] = useState<HintState | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });

  const inputs = useMemo(
    () => ({
      mode,
      currentPath: props.currentPath,
      settings,
      themeKey: props.themeKey,
    }),
    [mode, props.currentPath, settings, props.themeKey],
  );
  const { stageRef, overlayRef, sessionRef, state, shown } = useGraphSession({
    handle: props.handle,
    source,
    inputs,
    forceCanvas2d: props.forceCanvas2d,
    onOpen,
    onInteract: () => setHints(null),
  });

  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  const { onSession } = props;
  useEffect(() => {
    if (state.phase !== "ready") {
      return undefined;
    }
    onSession?.(sessionRef.current);
    return () => onSession?.(null);
  }, [state.phase, onSession, sessionRef]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stageRef]);

  const focusStage = useCallback(() => rootRef.current?.focus(), []);

  const startHints = () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    const map = session.hintMap();
    const at = new Map<number, { x: number; y: number }>();
    for (const node of map.labels.keys()) {
      at.set(node, session.nodeScreen(node));
    }
    setHints({ map, typed: "", at });
  };

  const onHintKey = (key: string, h: HintState) => {
    if (key === "Escape") {
      setHints(null);
    } else if (key === "Backspace") {
      setHints({ ...h, typed: h.typed.slice(0, -1) });
    } else if (key.length === 1) {
      const typed = h.typed + key.toLowerCase();
      const r = resolveHint(h.map, typed);
      if (r.kind === "match") {
        setHints(null);
        sessionRef.current?.activate(r.node);
      } else if (r.kind === "partial") {
        setHints({ ...h, typed });
      } else {
        setHints(null);
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isField(e.target)) {
      return;
    }
    const session = sessionRef.current;
    if (hints) {
      e.preventDefault();
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        onHintKey(e.key, hints);
      }
      return;
    }
    const action = actionForKey(e);
    if (!action) {
      return;
    }
    e.preventDefault();
    switch (action.type) {
      case "close":
        onClose();
        break;
      case "move":
        session?.moveFocus(action.dir);
        break;
      case "open": {
        const n = session
          ? session.shown >= 0
            ? session.shown
            : session.focus
          : -1;
        session?.activate(n);
        break;
      }
      case "filter":
        filterRef.current?.focus();
        filterRef.current?.select();
        break;
      case "toggleLocal":
        props.onModeChange(mode === "local" ? "global" : "local");
        break;
      case "depth":
        props.onSettingsChange({ ...settings, localDepth: action.depth });
        break;
      case "hints":
        startHints();
        break;
      case "fit":
        session?.userFit();
        break;
      case "zoom":
        session?.zoomCentre(action.dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
        break;
    }
  };

  const session = sessionRef.current;
  const hintLetters =
    shown && session ? session.hintMap().labels.get(shown.node) ?? null : null;
  const path = shown && session ? session.pathOf(shown.node) : null;

  return (
    <div
      ref={rootRef}
      className="vd-graph"
      tabIndex={-1}
      role="application"
      aria-label="Graph view"
      data-testid="graph-view"
      onKeyDown={onKeyDown}
    >
      <GraphToolbar
        settings={settings}
        onSettingsChange={props.onSettingsChange}
        mode={mode}
        onModeChange={props.onModeChange}
        onFit={() => sessionRef.current?.userFit()}
        onClose={onClose}
        panelOpen={panelOpen}
        onPanelToggle={() => setPanelOpen((v) => !v)}
        filterRef={filterRef}
        onFilterDone={focusStage}
      />
      <div className="vd-graph__body">
        <div
          ref={stageRef}
          className="vd-graph__stage"
          data-testid="graph-stage"
        >
          <canvas ref={overlayRef} className="vd-graph__overlay" />
          {shown && (
            <HoverCard
              shown={shown}
              shortcut={
                path && props.shortcutFor ? props.shortcutFor(path) : null
              }
              hint={hintLetters}
              width={size.w}
              height={size.h}
            />
          )}
          {hints &&
            [...hints.map.labels].map(([node, label]) => {
              if (!label.startsWith(hints.typed)) {
                return null;
              }
              const p = hints.at.get(node)!;
              return (
                <span
                  key={node}
                  className="vd-graph__hint"
                  style={{
                    transform: `translate(${p.x + 6}px, ${p.y - 18}px)`,
                  }}
                >
                  <b>{label.slice(0, hints.typed.length)}</b>
                  {label.slice(hints.typed.length)}
                </span>
              );
            })}
          {state.phase === "loading" && (
            <div className="vd-graph__note">Loading graph…</div>
          )}
          {state.phase === "error" && (
            <div className="vd-graph__note" role="alert">
              Could not load the graph{state.error ? `: ${state.error}` : ""}
            </div>
          )}
          {state.phase === "ready" && state.nodeCount === 0 && (
            <div className="vd-graph__note">
              No linked drawings yet. Type [[ in a drawing to link it.
            </div>
          )}
        </div>
        {panelOpen && (
          <SettingsPanel
            settings={settings}
            onChange={props.onSettingsChange}
          />
        )}
      </div>
    </div>
  );
}
