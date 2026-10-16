import { useCallback, useEffect, useRef } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import {
  getEffectiveToolDefaults,
  subscribeToolDefaults,
} from "../vault/toolDefaultsStore";

import { createToolDefaultHandlers } from "./toolDefaultCommands";
import {
  captureToolStyle,
  newContainerStyleOf,
  newTextStyleOf,
  newToolSession,
  switchTool,
} from "./toolApply";
import { getToolMemory, rememberToolStyle } from "./toolMemory";
import { isEmptyStyle, isStyledTool, type StyledTool } from "./toolStyles";

import type { RefObject } from "react";

/**
 * Applies each tool's saved default style when the tool becomes active (and
 * undoes it when it stops being). Observes the editor's onChange: every
 * change costs two ref writes and one string compare; work happens only when
 * the active tool changes. Nothing here re-renders React.
 */
export function useToolDefaults(
  apiRef: RefObject<ExcalidrawImperativeAPI | null>,
  enabled: boolean,
) {
  const session = useRef(newToolSession());
  const tool = useRef<string | null>(null);
  const state = useRef<AppState | null>(null);
  const styleKey = useRef("null");
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const enter = useCallback(
    (type: string | null, appState: AppState) => {
      const defaults = getEffectiveToolDefaults();
      const saved = isStyledTool(type) ? defaults[type] : undefined;
      styleKey.current = JSON.stringify(saved ?? null);
      // what the tool was last used with wins over its saved default
      const remembered = isStyledTool(type) ? getToolMemory(type) : undefined;
      const styles = remembered
        ? { ...defaults, [type as string]: remembered }
        : defaults;
      const out = switchTool(session.current, type, appState, styles);
      session.current = out.session;
      // the editor reports the patched state on its next change; until then
      // that is what was last seen
      session.current.lastSeen = { ...appState, ...out.patch };
      const api = apiRef.current;
      if (api && enabledRef.current && Object.keys(out.patch).length > 0) {
        api.updateScene({
          appState: out.patch as AppState,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    },
    [apiRef],
  );

  /** Remember the style `leaving` was last used with (the state seen while it was active). */
  const remember = useCallback((leaving: string | null) => {
    const style = captureToolStyle(
      session.current,
      leaving,
      session.current.lastSeen,
    );
    if (style && isStyledTool(leaving)) {
      rememberToolStyle(leaving, style);
    }
  }, []);

  // The editor going away (drawing switch) leaves the active tool too.
  useEffect(() => () => remember(tool.current), [remember]);

  /** Called with every editor change. */
  const onAppState = useCallback(
    (appState: AppState) => {
      const type = appState.activeTool.type;
      state.current = appState;
      if (type !== tool.current) {
        remember(tool.current);
        tool.current = type;
        // session.lastSeen is still the state before this change; enter()
        // leaves it at the patched state
        enter(type, appState);
      } else {
        session.current.lastSeen = appState;
      }
    },
    [enter, remember],
  );

  // Defaults edited (settings, live reload, vault switch) for the active tool.
  useEffect(
    () =>
      subscribeToolDefaults(() => {
        const current = state.current;
        if (!current || tool.current === null) {
          return;
        }
        const type = tool.current;
        const style = isStyledTool(type)
          ? getEffectiveToolDefaults()[type]
          : undefined;
        if (JSON.stringify(style ?? null) !== styleKey.current) {
          // re-apply: everything we applied is restored first (nothing was
          // changed by someone else as far as this call is concerned)
          const live = apiRef.current?.getAppState() ?? current;
          session.current.lastSeen = live;
          enter(type, live);
        }
      }),
    [enter, apiRef],
  );

  /** Width in px for a new element, or null (use the panel's width key). */
  const currentItemStrokeWidth = useCallback(
    (elementType: ExcalidrawElement["type"]) => {
      const s = session.current;
      const live = apiRef.current?.getAppState() ?? state.current;
      if (
        s.tool === null ||
        s.strokeWidthPx === null ||
        s.tool !== elementType ||
        !live ||
        live.currentItemStrokeWidthKey !== s.applied.currentItemStrokeWidthKey
      ) {
        return null;
      }
      return s.strokeWidthPx;
    },
    [apiRef],
  );

  /**
   * The Text tool's style for text created without it (double-click, Enter
   * on a shape, labels, paste): remembered, else saved default. Null while
   * the Text tool is active (its style is already the editor's) or when the
   * Text tool has no default (the editor's current style, as upstream).
   */
  const newTextStyle = useCallback(() => {
    if (!enabledRef.current || tool.current === "text") {
      return null;
    }
    const saved = getEffectiveToolDefaults().text;
    if (isEmptyStyle(saved)) {
      return null;
    }
    return newTextStyleOf(getToolMemory("text") ?? saved!);
  }, []);

  /** The Rectangle tool's style for "Wrap selection in container". */
  const newContainerStyle = useCallback(() => {
    if (!enabledRef.current) {
      return null;
    }
    const saved = getEffectiveToolDefaults().rectangle;
    if (isEmptyStyle(saved)) {
      return null;
    }
    return newContainerStyleOf(getToolMemory("rectangle") ?? saved!);
  }, []);

  useEffect(
    () =>
      registerCommandHandlers(
        createToolDefaultHandlers({
          api: () => apiRef.current,
          strokePx: (t: StyledTool) => currentItemStrokeWidth(t),
        }),
      ),
    [apiRef, currentItemStrokeWidth],
  );

  return {
    onAppState,
    currentItemStrokeWidth,
    newTextStyle,
    newContainerStyle,
  };
}
