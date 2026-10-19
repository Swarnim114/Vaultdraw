/**
 * Standard (untransformed) colours for thumbnail renders. canvasSync is loaded
 * lazily so importing the thumbnail modules never pulls the editor in.
 *
 * "Sync canvas with theme" repaints every mounted editor when it is released
 * (canvasSync.suspendCanvasSync). A per-job release would repaint the live
 * editor after every thumbnail, so the job queue holds ONE suspension per
 * drain (enterStandardColors) and the per-render wrapper nests inside it for
 * free (the counter only repaints on the last release).
 */

/** Resolves a release function; the last release restores the theme colours. */
export type ColorScope = () => Promise<() => void>;

export const enterStandardColors: ColorScope = async () => {
  const { suspendCanvasSync } = await import("../editor/canvasSync");
  return suspendCanvasSync();
};

export const withStandardColors = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  const { withStandardCanvasColors } = await import("../editor/canvasSync");
  return withStandardCanvasColors(task);
};
