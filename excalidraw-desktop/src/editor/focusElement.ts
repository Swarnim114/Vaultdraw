import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type FocusTarget = { elementId: string; containerId: string | null };

/** Breathing room around the focused element, as a fraction of its size. */
const PADDING_RATIO = 0.25;
const MIN_PADDING = 40;

/**
 * Selects an element (the container for bound text) and brings it into view.
 * Small elements are only centered at the current zoom (setViewport
 * `scale-down` never exceeds 100%); large ones zoom out to fit.
 * Returns false when the element no longer exists.
 */
export function focusElement(
  api: ExcalidrawImperativeAPI,
  target: FocusTarget,
): boolean {
  const elements = api.getSceneElements();
  const byId = (id: string | null) =>
    id ? elements.find((el) => el.id === id && !el.isDeleted) : undefined;
  const own = byId(target.elementId);
  const ownContainerId = (own as { containerId?: string | null } | undefined)
    ?.containerId;
  const resolved =
    byId(target.containerId) ?? byId(ownContainerId ?? null) ?? own;
  if (!resolved) {
    return false;
  }

  api.updateScene({
    appState: {
      selectedElementIds: { [resolved.id]: true },
      selectedGroupIds: {},
      editingGroupId: null,
    },
    captureUpdate: "NEVER",
  });

  const pad = Math.max(
    MIN_PADDING,
    Math.max(resolved.width, resolved.height) * PADDING_RATIO,
  );
  api.setViewport({
    target: [
      resolved.x - pad,
      resolved.y - pad,
      resolved.x + resolved.width + pad,
      resolved.y + resolved.height + pad,
    ],
    fit: "scale-down",
    animation: true,
  });
  return true;
}
