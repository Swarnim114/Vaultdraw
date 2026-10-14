/**
 * Turns a template scene into a fresh drawing: every element id is remapped
 * so the new drawing never shares ids with the template (or another drawing
 * made from it). Pure; no editor needed.
 */
import { randomId } from "@excalidraw/common";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function instantiateTemplate(
  json: string,
  opts: { theme?: "light" | "dark" } = {},
): string {
  const scene = JSON.parse(json) as Json;
  if (!scene || typeof scene !== "object" || !Array.isArray(scene.elements)) {
    throw new Error("Not an Excalidraw scene");
  }
  const elements = (scene.elements as Json[]).filter((e) => !e.isDeleted);

  const used = new Set<string>(
    (scene.elements as Json[]).map((e) => String(e.id)),
  );
  const fresh = (): string => {
    let id = randomId();
    while (used.has(id)) {
      id = randomId();
    }
    used.add(id);
    return id;
  };
  const elementIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const mapOf = (table: Map<string, string>, old: string) => {
    let next = table.get(old);
    if (!next) {
      next = fresh();
      table.set(old, next);
    }
    return next;
  };
  for (const el of elements) {
    mapOf(elementIds, String(el.id));
  }
  // A reference to an element that is not in the scene is dropped.
  const ref = (old: unknown): string | null =>
    typeof old === "string" ? elementIds.get(old) ?? null : null;

  const out = elements.map((el) => {
    const next: Json = { ...el, id: elementIds.get(String(el.id)) };
    if (Array.isArray(el.groupIds)) {
      next.groupIds = el.groupIds.map((g: string) => mapOf(groupIds, g));
    }
    if ("frameId" in el) {
      next.frameId = ref(el.frameId);
    }
    if ("containerId" in el) {
      next.containerId = ref(el.containerId);
    }
    if (Array.isArray(el.boundElements)) {
      next.boundElements = el.boundElements
        .map((b: Json) => ({ ...b, id: ref(b.id) }))
        .filter((b: Json) => b.id);
    }
    for (const key of ["startBinding", "endBinding"]) {
      const binding = el[key];
      if (binding && typeof binding === "object") {
        const elementId = ref(binding.elementId);
        next[key] = elementId ? { ...binding, elementId } : null;
      }
    }
    if (Array.isArray(el.elements)) {
      next.elements = el.elements.map(ref).filter(Boolean);
    }
    return next;
  });

  const appState: Json = { ...(scene.appState ?? {}) };
  if (opts.theme) {
    appState.theme = opts.theme;
  }
  return JSON.stringify({ ...scene, elements: out, appState }, null, 2);
}
