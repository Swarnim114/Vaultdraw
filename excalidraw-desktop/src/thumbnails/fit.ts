/**
 * Pure geometry for disk-cache thumbnails: the whole scene is fitted into a
 * fixed 4:3 box at the display's pixel density, with padding, centred
 * (letterboxed), never cropped and never magnified beyond MAX_ZOOM. Every
 * thumbnail PNG is exactly the box, so CSS `object-fit: contain` maps it onto
 * any 4:3 tile at the same zoom (no bitmap upscaling of small drawings).
 */

/**
 * CSS size of the box. It covers the largest surface (the 300 px Cmd+P
 * preview); smaller tiles (Home 160-200 px, gallery 192 px) downscale it.
 */
export const THUMB_BOX_CSS = { width: 320, height: 240 } as const;
/** Padding on every side, as a fraction of the box's short edge. */
export const THUMB_PAD_RATIO = 0.06;
/**
 * At most 2 scene units per CSS pixel: a single short word stays readable
 * instead of filling the tile edge to edge.
 */
export const THUMB_MAX_ZOOM = 2;

/** Device pixels per CSS pixel for thumbnails: 1 or 2 (Retina). */
export const thumbDensity = (devicePixelRatio: number | undefined): 1 | 2 =>
  (devicePixelRatio ?? 1) >= 1.5 ? 2 : 1;

export type ThumbFit = {
  /** Output PNG size in device pixels (always the box). */
  boxWidth: number;
  boxHeight: number;
  /** Device pixels per scene unit. */
  scale: number;
  /** Size of the drawn content, device pixels (rounded up). */
  width: number;
  height: number;
  /** Top-left of the content inside the box, device pixels. */
  x: number;
  y: number;
};

/**
 * Fit content of `contentWidth` x `contentHeight` scene units into the box
 * at `density`. Very wide or tall drawings shrink to the box's long side and
 * are letterboxed on the other axis.
 */
export const fitThumb = (
  contentWidth: number,
  contentHeight: number,
  density: number,
): ThumbFit => {
  const boxWidth = THUMB_BOX_CSS.width * density;
  const boxHeight = THUMB_BOX_CSS.height * density;
  const pad = Math.round(Math.min(boxWidth, boxHeight) * THUMB_PAD_RATIO);
  const w = Math.max(contentWidth, 1e-6);
  const h = Math.max(contentHeight, 1e-6);
  const scale = Math.min(
    (boxWidth - 2 * pad) / w,
    (boxHeight - 2 * pad) / h,
    THUMB_MAX_ZOOM * density,
  );
  const width = Math.min(boxWidth, Math.max(1, Math.ceil(w * scale)));
  const height = Math.min(boxHeight, Math.max(1, Math.ceil(h * scale)));
  return {
    boxWidth,
    boxHeight,
    scale,
    width,
    height,
    x: Math.floor((boxWidth - width) / 2),
    y: Math.floor((boxHeight - height) / 2),
  };
};
