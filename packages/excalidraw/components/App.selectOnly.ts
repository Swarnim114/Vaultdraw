import {
  EVENT,
  KEYS,
  POINTER_BUTTON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import {
  CaptureUpdateAction,
  getElementsWithinSelection,
  newElement,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { actionSelectAll } from "../actions/actionSelectAll";

import type React from "react";

import type App from "./App";

// a drag shorter than this is a click, not a marquee
const MARQUEE_THRESHOLD_PX = 3;

/**
 * Select-only input for the otherwise non-interactive editor
 * (`interaction.enabled.select`): click / shift-click / marquee / select-all /
 * Escape. It is a deliberately separate, tiny input path instead of a gated
 * run through the editing pointer flow, so there is no drag, resize, rotate,
 * edit or tool code reachable from it — it only ever writes selection
 * appState, never elements.
 */
export class AppSelectOnly {
  private teardown: (() => void) | null = null;

  constructor(private app: App) {}

  /** starts a click / marquee session; returns whether it took the press */
  onPointerDown = (event: React.PointerEvent<HTMLElement>): boolean => {
    const { app } = this;
    if (
      event.button !== POINTER_BUTTON.MAIN ||
      app.pan.isSpaceHeld() ||
      // a second finger belongs to the pinch gesture, not a new selection
      (this.teardown && event.pointerType === "touch")
    ) {
      return false;
    }
    this.teardown?.();
    app.focusContainer();
    event.preventDefault();

    const origin = viewportCoordsToSceneCoords(event, app.state);
    const hit = app.getElementAtPosition(origin.x, origin.y);
    const shift = event.shiftKey;
    const baseIds = shift ? { ...app.state.selectedElementIds } : {};
    let marquee = false;

    const onMove = (e: PointerEvent) => {
      if (
        !marquee &&
        Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) <
          MARQUEE_THRESHOLD_PX
      ) {
        return;
      }
      marquee = true;
      const p = viewportCoordsToSceneCoords(e, app.state);
      const selectionElement = newElement({
        type: "selection",
        x: Math.min(origin.x, p.x),
        y: Math.min(origin.y, p.y),
        width: Math.abs(p.x - origin.x),
        height: Math.abs(p.y - origin.y),
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        locked: false,
        frameId: null,
      });
      const within = getElementsWithinSelection(
        app.scene.getNonDeletedElements(),
        selectionElement,
        app.scene.getNonDeletedElementsMap(),
        false,
        app.state.boxSelectionMode,
      );
      const ids = { ...baseIds };
      for (const el of within) {
        ids[el.id] = true;
      }
      this.select(ids, selectionElement);
    };

    const end = () => {
      app.ownerWindow.removeEventListener(EVENT.POINTER_MOVE, onMove);
      app.ownerWindow.removeEventListener(EVENT.POINTER_UP, onUp);
      this.teardown = null;
    };
    const onUp = () => {
      end();
      if (marquee) {
        app.setState({ selectionElement: null });
      } else if (hit) {
        const ids = { ...baseIds };
        // shift-click toggles the hit element
        if (shift && ids[hit.id]) {
          delete ids[hit.id];
        } else {
          ids[hit.id] = true;
        }
        this.select(ids);
      } else if (!shift) {
        app.deselectElements();
      }
    };
    app.ownerWindow.addEventListener(EVENT.POINTER_MOVE, onMove);
    app.ownerWindow.addEventListener(EVENT.POINTER_UP, onUp);
    this.teardown = end;
    return true;
  };

  /** Mod+A selects everything, Escape clears; nothing else is handled */
  onKeyDown = (event: KeyboardEvent) => {
    const { app } = this;
    if (event.key === KEYS.ESCAPE) {
      app.deselectElements();
    } else if (
      event[KEYS.CTRL_OR_CMD] &&
      !event.altKey &&
      event.key.toLowerCase() === KEYS.A
    ) {
      const result = actionSelectAll.perform(
        app.scene.getElementsIncludingDeleted(),
        app.state,
        null,
        app,
      );
      if (result && !(result instanceof Promise)) {
        // selection must never become an undo step
        app.syncActionResult({
          ...result,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  /** ends a session in flight (editor teardown) */
  end = () => this.teardown?.();

  private select = (
    selectedElementIds: Record<string, true>,
    selectionElement: App["state"]["selectionElement"] = null,
  ) => {
    const { app } = this;
    app.setState({
      ...selectGroupsForSelectedElements(
        { editingGroupId: null, selectedElementIds },
        app.scene.getNonDeletedElements() as readonly NonDeletedExcalidrawElement[],
        app.state,
        app,
      ),
      selectionElement,
    });
  };
}
