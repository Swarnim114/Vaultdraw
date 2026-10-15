/**
 * Handlers of the "toolDefaults.*" commands (ids in commands.ts). The open
 * editor builds them with its api and registers them through
 * registerCommandHandlers (see useToolDefaults).
 */
import { arrayToMap } from "@excalidraw/common";
import { getBoundTextElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { resetToolDefault, saveToolDefault } from "../vault/toolDefaultsStore";

import { toastStore } from "../toasts/toastStore";

import {
  TOOL_DEFAULT_SAVE_ACTIVE_ID,
  toolDefaultResetId,
  toolDefaultSaveId,
} from "./toolDefaultIds";

import { clearToolMemory } from "./toolMemory";
import { styleFromAppState, styleFromElement } from "./toolApply";
import {
  TOOL_DEFAULT_TOOLS,
  TOOL_LABELS,
  isStyledTool,
  type StyledTool,
} from "./toolStyles";

import type { CommandHandlers } from "../commands/types";

const TOAST_MS = 2500;

export interface ToolDefaultDeps {
  api: () => ExcalidrawImperativeAPI | null;
  /** Stroke width in px the active tool's saved style applied, else null. */
  strokePx: (tool: StyledTool) => number | null;
}

/** First selected element of the tool's type (text: also bound text). */
function selectedOfTool(
  api: ExcalidrawImperativeAPI,
  tool: StyledTool,
): ExcalidrawElement | null {
  const selected = api.getAppState().selectedElementIds;
  const elements = api.getSceneElements();
  const picked = elements.filter((el) => selected[el.id]);
  if (tool !== "text") {
    return picked.find((el) => el.type === tool) ?? null;
  }
  const map = arrayToMap(elements);
  for (const el of picked) {
    const text = el.type === "text" ? el : getBoundTextElement(el, map);
    if (text) {
      return text;
    }
  }
  return null;
}

/** The styled tool a selection is about: all selected elements share one type. */
function selectionTool(api: ExcalidrawImperativeAPI): StyledTool | null {
  const selected = api.getAppState().selectedElementIds;
  const types = new Set(
    api
      .getSceneElements()
      .filter((el) => selected[el.id])
      .map((el) => el.type),
  );
  if (types.size !== 1) {
    return null;
  }
  const [type] = types;
  return isStyledTool(type) ? type : null;
}

export function createToolDefaultHandlers(
  deps: ToolDefaultDeps,
): CommandHandlers {
  const toast = (message: string) =>
    toastStore.push({ message, durationMs: TOAST_MS });

  const save = async (tool: StyledTool) => {
    const api = deps.api();
    if (!api) {
      return;
    }
    const element = selectedOfTool(api, tool);
    const style = element
      ? styleFromElement(tool, element)
      : styleFromAppState(tool, api.getAppState(), deps.strokePx(tool));
    // before the write, so the editor's re-apply sees the new default
    clearToolMemory(tool);
    const layer = await saveToolDefault(tool, style);
    toast(
      `Saved ${TOOL_LABELS[tool]} style as the default (${
        layer === "vault" ? "this vault" : "global"
      })`,
    );
  };

  const reset = async (tool: StyledTool) => {
    clearToolMemory(tool);
    const layer = await resetToolDefault(tool);
    toast(
      `Reset ${TOOL_LABELS[tool]} default (${
        layer === "vault" ? "this vault" : "global"
      })`,
    );
  };

  const saveActive = async () => {
    const api = deps.api();
    if (!api) {
      return;
    }
    const active = api.getAppState().activeTool.type;
    const tool = isStyledTool(active) ? active : selectionTool(api);
    if (!tool) {
      toast("Pick a tool or select a shape first");
      return;
    }
    await save(tool);
  };

  return {
    ...Object.fromEntries(
      TOOL_DEFAULT_TOOLS.flatMap((tool) => [
        [toolDefaultSaveId(tool), () => save(tool)],
        [toolDefaultResetId(tool), () => reset(tool)],
      ]),
    ),
    [TOOL_DEFAULT_SAVE_ACTIVE_ID]: saveActive,
  };
}
