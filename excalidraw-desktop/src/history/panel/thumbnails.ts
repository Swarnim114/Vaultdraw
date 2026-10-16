/**
 * In-memory thumbnails for version rows and the timeline, alive for the panel's
 * lifetime only (nothing is written to disk). Rendering reuses the templates'
 * renderer, which already serialises jobs and yields between them, so a burst
 * of rows never produces a long task.
 */
import { useEffect, useState } from "react";

import {
  createThumbnailRenderer,
  type ThumbnailRenderer,
} from "../../templates/thumbnails";

import type { VersionInfo } from "../types";

/**
 * Versions with more elements than this get a neutral placeholder: rendering
 * them would exceed the 50 ms long-task budget on a low-end machine. Exported
 * so the step-0 measurement can tune it.
 */
export let HISTORY_THUMB_MAX_ELEMENTS = 1000;
export const setHistoryThumbMaxElements = (n: number) => {
  HISTORY_THUMB_MAX_ELEMENTS = n;
};

export interface PanelThumbnails {
  /** False for unknown, over-cap or not-local versions (placeholder). */
  eligible(v: Pick<VersionInfo, "elementCount" | "availability">): boolean;
  request(id: string): Promise<string | null>;
  cancel(id: string): void;
  clear(): void;
}

export const createPanelThumbnails = (
  json: (id: string) => Promise<string>,
  renderer: ThumbnailRenderer = createThumbnailRenderer({ maxCache: 200 }),
): PanelThumbnails => ({
  eligible: (v) =>
    v.availability === "local" &&
    v.elementCount !== null &&
    v.elementCount <= HISTORY_THUMB_MAX_ELEMENTS,
  request: (id) => renderer.request(id, () => json(id)),
  cancel: (id) => renderer.cancel(id),
  clear: () => renderer.clear(),
});

/**
 * The thumbnail data URL for `version`, requested while the caller is mounted
 * (rows are only mounted when visible). Checkpoints request first: others wait
 * one tick, so within a commit the checkpoint jobs are queued ahead of them.
 */
export function useThumbnail(
  thumbs: PanelThumbnails,
  version: Pick<VersionInfo, "id" | "reason" | "elementCount" | "availability">,
  enabled = true,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const { id, reason } = version;
  const eligible = enabled && thumbs.eligible(version);
  useEffect(() => {
    setUrl(null);
    if (!eligible) {
      return;
    }
    let live = true;
    const start = () => void thumbs.request(id).then((v) => live && setUrl(v));
    const timer = reason === "checkpoint" ? null : setTimeout(start, 0);
    if (!timer) {
      start();
    }
    return () => {
      live = false;
      if (timer) {
        clearTimeout(timer);
      }
      thumbs.cancel(id);
    };
  }, [thumbs, id, reason, eligible]);
  return url;
}
