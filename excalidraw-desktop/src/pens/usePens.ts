import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { getCommand, penCommandId } from "../commands/commands";
import { detectPlatform, formatChord } from "../commands/keys";
import { effectiveKeys } from "../commands/keymap";
import { useHotkeyOverrides } from "../commands/useCommands";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { registerPenSelector } from "./penCommands";

import {
  laserToPointerSettings,
  penToAppState,
  penToFreedrawPen,
} from "./penApply";

import type { RefObject } from "react";

import type { PenPreset } from "./penPresets";

type PenState = Pick<
  AppState,
  | "activeTool"
  | "currentItemStrokeColor"
  | "currentItemOpacity"
  | "currentItemStrokeVariability"
  | "currentItemStrokeWidthKey"
>;

/** What the user last saw applied; a later difference means a manual change. */
type Applied = {
  color: string;
  opacity: number;
  variability: string;
  /** Learned from the first state that shows the preset applied. */
  widthKey: string | null;
};

/** Display text of each pen's first chord ("" when unassigned). */
function usePenShortcuts(count: number): string[] {
  const overrides = useHotkeyOverrides(null);
  return useMemo(() => {
    const platform = detectPlatform();
    return Array.from({ length: count }, (_, i) => {
      const command = getCommand(penCommandId(i));
      const [chord] = command
        ? effectiveKeys(command, overrides, platform)
        : [];
      return chord ? formatChord(chord, platform) : "";
    });
  }, [count, overrides]);
}

/** Presets from preferences; the state only changes when their content does. */
function usePresets(): PenPreset[] {
  const [presets, setPresets] = useState(() => getPreferences().penPresets);
  useEffect(() => {
    let key = JSON.stringify(presets);
    return subscribePreferences(() => {
      const next = getPreferences().penPresets;
      const nextKey = JSON.stringify(next);
      if (nextKey !== key) {
        key = nextKey;
        setPresets(next);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return presets;
}

/**
 * Active pen preset of the editor. `freedrawPen` / `laserPointerOptions` keep
 * one identity for the editor's lifetime and read refs, so strokes never
 * re-render. State only changes on tool switch, selection or manual override.
 */
export function usePens(
  apiRef: RefObject<ExcalidrawImperativeAPI | null>,
  enabled: boolean,
) {
  const presets = usePresets();
  const shortcuts = usePenShortcuts(presets.length);
  const [active, setActive] = useState<number | null>(null);
  const [freedrawActive, setFreedrawActive] = useState(false);
  const presetsRef = useRef(presets);
  const activeRef = useRef<number | null>(null);
  const freedrawRef = useRef(false);
  const applied = useRef<Applied | null>(null);
  const enabledRef = useRef(enabled);
  presetsRef.current = presets;
  enabledRef.current = enabled;

  const setActiveIndex = useCallback((index: number | null) => {
    activeRef.current = index;
    if (index === null) {
      applied.current = null;
    }
    setActive(index);
  }, []);

  // Presets edited in settings: the applied look is stale, drop the selection.
  const firstPresets = useRef(true);
  useEffect(() => {
    if (firstPresets.current) {
      firstPresets.current = false;
    } else {
      setActiveIndex(null);
    }
  }, [presets, setActiveIndex]);

  const selectPen = useCallback(
    (index: number) => {
      const api = apiRef.current;
      const preset = presetsRef.current[index];
      if (!api || !preset || !enabledRef.current) {
        return;
      }
      const next = penToAppState(preset);
      applied.current = {
        color: next.currentItemStrokeColor,
        opacity: next.currentItemOpacity,
        variability: next.currentItemStrokeVariability,
        widthKey: null,
      };
      activeRef.current = index;
      setActive(index);
      api.updateScene({ appState: next });
      api.setActiveTool({ type: "freedraw" });
    },
    [apiRef],
  );

  /** Called with every editor change; cheap compares, no work per stroke. */
  const onAppState = useCallback(
    (state: PenState) => {
      const isFreedraw = state.activeTool.type === "freedraw";
      if (isFreedraw !== freedrawRef.current) {
        freedrawRef.current = isFreedraw;
        setFreedrawActive(isFreedraw);
      }
      const want = applied.current;
      if (activeRef.current === null || !want) {
        return;
      }
      const matches =
        state.currentItemStrokeColor === want.color &&
        state.currentItemOpacity === want.opacity &&
        state.currentItemStrokeVariability === want.variability;
      if (want.widthKey === null) {
        // Not seen applied yet: ignore state from before the selection.
        if (matches) {
          want.widthKey = state.currentItemStrokeWidthKey;
        }
        return;
      }
      if (!matches || state.currentItemStrokeWidthKey !== want.widthKey) {
        setActiveIndex(null);
      }
    },
    [setActiveIndex],
  );

  const freedrawPen = useCallback(() => {
    const preset =
      activeRef.current === null ? null : presetsRef.current[activeRef.current];
    return preset ? penToFreedrawPen(preset) : null;
  }, []);

  const laserPointerOptions = useCallback(
    () => laserToPointerSettings(getPreferences()),
    [],
  );

  // Alt+1..9 by default: the "pen.selectN" commands (rebindable, Hotkeys page).
  useEffect(() => registerPenSelector(selectPen), [selectPen]);

  return {
    presets,
    shortcuts,
    active,
    freedrawActive,
    selectPen,
    onAppState,
    freedrawPen,
    laserPointerOptions,
  };
}
