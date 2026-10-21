import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  StyleOverridesHook,
} from "@excalidraw/excalidraw/types";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getPreferences, subscribePreferences } from "../vault/preferences";
import {
  getEffectiveToolDefaults,
  subscribeToolDefaults,
} from "../vault/toolDefaultsStore";

import { baseStyleAppState, editorDefaultsKey } from "./baseStyle";
import {
  clearDrawingStyle,
  effectiveToolStyle,
  isEmptyDrawingStyles,
  setDrawingStyle,
  type DrawingStyles,
} from "./drawingStyles";
import { createToolDefaultHandlers } from "./toolDefaultCommands";
import {
  STYLE_FIELDS,
  newContainerStyleOf,
  newTextStyleOf,
  newToolSession,
  styleKeyOfField,
  styleKeyValue,
  switchTool,
} from "./toolApply";
import {
  TOOL_STYLE_KEYS,
  isEmptyStyle,
  isStyledTool,
  type StyledTool,
  type ToolStyleKey,
} from "./toolStyles";

import type { RefObject } from "react";

type Field = keyof AppState;
type Loose = Record<string, unknown>;

const ownsKey = (tool: StyledTool, key: ToolStyleKey) =>
  TOOL_STYLE_KEYS[tool].includes(key);

const hasSelection = (selected: AppState["selectedElementIds"]) => {
  for (const id in selected) {
    if (selected[id]) {
      return true;
    }
  }
  return false;
};

/** Mapped fields whose value differs (null when none: no allocation). */
function changedFields(a: Partial<AppState>, b: Partial<AppState>) {
  let changed: Field[] | null = null;
  for (const field of STYLE_FIELDS) {
    if (a[field] !== b[field]) {
      (changed ??= []).push(field);
    }
  }
  return changed;
}

/**
 * The styled tool types a selection (or the text being edited) stands for:
 * its elements' types, plus "text" for a container with a bound label.
 */
function selectionTools(
  api: ExcalidrawImperativeAPI,
  appState: AppState,
): Set<StyledTool> {
  const tools = new Set<StyledTool>();
  if (appState.editingTextElement) {
    tools.add("text");
  }
  const selected = appState.selectedElementIds;
  for (const el of api.getSceneElements() as readonly ExcalidrawElement[]) {
    if (!selected[el.id]) {
      continue;
    }
    if (isStyledTool(el.type)) {
      tools.add(el.type);
    }
    if (el.boundElements?.some((b) => b.type === "text")) {
      tools.add("text");
    }
  }
  return tools;
}

export interface ToolDefaultsOptions {
  /** The drawing's overrides changed (the editor schedules a save). */
  onOverridesChange?: () => void;
}

/**
 * Applies each tool's style when the tool becomes active: its effective
 * default (global, This vault) with this drawing's picks on top. A style
 * picked inside the drawing is recorded as a per-drawing override (saved
 * with the drawing by the editor). Observes the editor's onChange: every
 * change costs a few ref writes and up to 14 field compares; work happens
 * only when the tool or a style field changed. Nothing here re-renders React
 * except when the overrides change.
 */
export function useToolDefaults(
  apiRef: RefObject<ExcalidrawImperativeAPI | null>,
  enabled: boolean,
  { onOverridesChange }: ToolDefaultsOptions = {},
) {
  const session = useRef(newToolSession());
  const tool = useRef<string | null>(null);
  const state = useRef<AppState | null>(null);
  const styleKey = useRef("null");
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const changeRef = useRef(onOverridesChange);
  changeRef.current = onOverridesChange;
  const drawing = useRef<DrawingStyles>({});
  const version = useRef(0);
  const [overridesVersion, setOverridesVersion] = useState(0);

  const patchScene = useCallback(
    (patch: Loose) => {
      const api = apiRef.current;
      if (api && enabledRef.current && Object.keys(patch).length > 0) {
        api.updateScene({
          appState: patch as unknown as AppState,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    },
    [apiRef],
  );

  const styleOf = useCallback(
    (type: string | null) =>
      isStyledTool(type)
        ? effectiveToolStyle(getEffectiveToolDefaults(), drawing.current, type)
        : undefined,
    [],
  );

  /** Enter `type` from `appState` (`extra`: fields already merged into it that still have to be sent). */
  const enter = useCallback(
    (type: string | null, appState: AppState, extra: Loose = {}) => {
      const style = styleOf(type);
      styleKey.current = JSON.stringify(style ?? null);
      const out = switchTool(
        session.current,
        type,
        appState,
        isStyledTool(type) && style ? { [type]: style } : {},
      );
      session.current = out.session;
      // the editor reports the patched state on its next change; until then
      // that is what was last seen (so our own patches never record)
      session.current.lastSeen = { ...appState, ...out.patch };
      patchScene({ ...extra, ...out.patch });
    },
    [styleOf, patchScene],
  );

  /** Re-apply the active tool (and, with `base`, the [editor] base style) without touching elements. */
  const resync = useCallback(
    (base: boolean) => {
      const live = apiRef.current?.getAppState() ?? state.current;
      if (!live) {
        return;
      }
      session.current.lastSeen = live;
      if (!base) {
        enter(tool.current, live);
        return;
      }
      const left = switchTool(session.current, null, live, {});
      session.current = left.session;
      const wanted: Loose = {
        ...left.patch,
        ...baseStyleAppState(getPreferences()),
      };
      const extra: Loose = {};
      for (const field of Object.keys(wanted)) {
        if (wanted[field] !== (live as unknown as Loose)[field]) {
          extra[field] = wanted[field];
        }
      }
      enter(tool.current, { ...live, ...extra }, extra);
    },
    [apiRef, enter],
  );

  const commit = useCallback((next: DrawingStyles) => {
    drawing.current = next;
    version.current += 1;
    setOverridesVersion(version.current);
    changeRef.current?.();
  }, []);

  /** Record the mapped fields that changed while the tool stayed the same. */
  const record = useCallback(
    (appState: AppState, seen: Partial<AppState>, changed: Field[]) => {
      const api = apiRef.current;
      const selecting =
        !!api &&
        (!!appState.editingTextElement ||
          hasSelection(appState.selectedElementIds));
      const picked = selecting ? selectionTools(api, appState) : null;
      const activeType = appState.activeTool.type;
      const active = isStyledTool(activeType) ? activeType : null;
      const restore: Loose = {};
      let next = drawing.current;
      for (const field of changed) {
        const key = styleKeyOfField(field);
        if (!key) {
          continue;
        }
        const value = styleKeyValue(key, appState);
        const activeOwns = !!active && ownsKey(active, key);
        if (picked) {
          let owned = false;
          for (const t of picked) {
            if (ownsKey(t, key)) {
              owned = true;
              next = setDrawingStyle(next, t, key, value);
            }
          }
          if (owned && !activeOwns) {
            restore[field] = (seen as Loose)[field];
            continue;
          }
        } else if (activeOwns) {
          next = setDrawingStyle(next, active, key, value);
        } else {
          continue;
        }
        if (activeOwns && session.current.tool === active) {
          // the active tool's applied style follows the pick (px width too)
          session.current.applied[field] = (appState as unknown as Loose)[
            field
          ];
          if (key === "stroke_width") {
            session.current.strokeWidthPx = value as number;
          }
        }
      }
      if (Object.keys(restore).length > 0) {
        session.current.lastSeen = { ...appState, ...restore };
        patchScene(restore);
      }
      if (next !== drawing.current) {
        commit(next);
      }
    },
    [apiRef, patchScene, commit],
  );

  /**
   * A different document is shown: start a fresh session (the new state is
   * not the old one plus our patch, so nothing applied to the old scene may
   * be undone on it). The drawing's own picks arrive with `loadDrawingStyles`.
   */
  const reset = useCallback(() => {
    session.current = newToolSession();
    tool.current = null;
    state.current = null;
    styleKey.current = "null";
  }, []);

  /** Called with every editor change. */
  const onAppState = useCallback(
    (appState: AppState) => {
      const type = appState.activeTool.type;
      state.current = appState;
      if (type !== tool.current) {
        tool.current = type;
        // session.lastSeen is still the state before this change; enter()
        // leaves it at the patched state
        enter(type, appState);
        return;
      }
      const seen = session.current.lastSeen;
      session.current.lastSeen = appState;
      const changed = seen && changedFields(seen, appState);
      if (changed) {
        record(appState, seen, changed);
      }
    },
    [enter, record],
  );

  // Defaults edited (settings, live reload, vault switch) for the active tool.
  useEffect(
    () =>
      subscribeToolDefaults(() => {
        if (!state.current || tool.current === null) {
          return;
        }
        if (
          JSON.stringify(styleOf(tool.current) ?? null) !== styleKey.current
        ) {
          resync(false);
        }
      }),
    [styleOf, resync],
  );

  // [editor] defaults edited: the base style follows (elements are untouched).
  useEffect(() => {
    let last = editorDefaultsKey(getPreferences());
    return subscribePreferences(() => {
      const next = editorDefaultsKey(getPreferences());
      if (next !== last) {
        last = next;
        if (state.current) {
          resync(true);
        }
      }
    });
  }, [resync]);

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
   * on a shape, labels, paste): its default with this drawing's picks. Null
   * while the Text tool is active (its style is already the editor's) or when
   * nothing is set (the editor's current style, as upstream).
   */
  const newTextStyle = useCallback(() => {
    if (!enabledRef.current || tool.current === "text") {
      return null;
    }
    const style = styleOf("text");
    return isEmptyStyle(style) ? null : newTextStyleOf(style!);
  }, [styleOf]);

  /** The Rectangle tool's style for "Wrap selection in container". */
  const newContainerStyle = useCallback(() => {
    if (!enabledRef.current) {
      return null;
    }
    const style = styleOf("rectangle");
    return isEmptyStyle(style) ? null : newContainerStyleOf(style!);
  }, [styleOf]);

  /** The tools a style panel edit applies to: the selection's types, else the active tool. */
  const scopeTools = useCallback((): StyledTool[] => {
    const api = apiRef.current;
    if (!api) {
      return [];
    }
    const s = api.getAppState();
    if (s.editingTextElement || hasSelection(s.selectedElementIds)) {
      return [...selectionTools(api, s)];
    }
    return isStyledTool(s.activeTool.type) ? [s.activeTool.type] : [];
  }, [apiRef]);

  const keysOf = (fields: readonly Field[]) =>
    fields.flatMap((f) => styleKeyOfField(f) ?? []);

  // new identity whenever the overrides change (the style panel re-renders)
  const styleOverrides = useMemo<StyleOverridesHook>(
    () => ({
      isOverridden: (fields) => {
        const keys = keysOf(fields);
        return (
          keys.length > 0 &&
          scopeTools().some((t) =>
            keys.some((key) => drawing.current[t]?.[key] !== undefined),
          )
        );
      },
      useDefault: (fields) => {
        const tools = scopeTools();
        const next = clearDrawingStyle(drawing.current, tools, keysOf(fields));
        if (next === drawing.current) {
          return;
        }
        commit(next);
        if (isStyledTool(tool.current) && tools.includes(tool.current)) {
          resync(false);
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overridesVersion, scopeTools, commit, resync],
  );

  /** Forget every pick of this drawing (palette command). */
  const resetDrawingStyles = useCallback(() => {
    if (isEmptyDrawingStyles(drawing.current)) {
      return;
    }
    commit({});
    if (isStyledTool(tool.current)) {
      resync(false);
    }
  }, [commit, resync]);

  /** A tool's default was saved or reset: this drawing's picks for it no longer apply. */
  const clearToolOverrides = useCallback(
    (t: StyledTool) => {
      const next = clearDrawingStyle(drawing.current, [t]);
      if (next !== drawing.current) {
        commit(next);
      }
    },
    [commit],
  );

  /** The overrides the drawing was opened with (no save, no render). */
  /** The shown drawing's overrides (the style panel re-reads them). */
  const loadDrawingStyles = useCallback((styles: DrawingStyles) => {
    drawing.current = styles;
    version.current += 1;
    setOverridesVersion(version.current);
  }, []);

  const getDrawingStyles = useCallback(() => drawing.current, []);
  const getOverridesVersion = useCallback(() => version.current, []);

  useEffect(
    () =>
      registerCommandHandlers(
        createToolDefaultHandlers({
          api: () => apiRef.current,
          strokePx: (t: StyledTool) => currentItemStrokeWidth(t),
          drawingStyle: (t: StyledTool) => drawing.current[t],
          clearToolOverrides,
          resetDrawingStyles,
        }),
      ),
    [apiRef, currentItemStrokeWidth, clearToolOverrides, resetDrawingStyles],
  );

  return {
    onAppState,
    reset,
    currentItemStrokeWidth,
    newTextStyle,
    newContainerStyle,
    styleOverrides,
    resetDrawingStyles,
    loadDrawingStyles,
    getDrawingStyles,
    getOverridesVersion,
  };
}
