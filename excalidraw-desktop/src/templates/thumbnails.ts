// The renderer moved to src/thumbnails (one render core, one job queue, shared
// with the disk-cached thumbnails). Re-exported so importers keep working.
export {
  THUMBNAIL_MAX_ELEMENTS,
  THUMBNAIL_MAX_SIZE,
  renderSceneToSvgDataUrl,
} from "../thumbnails/render";
export type { RenderSvg } from "../thumbnails/render";
export { createThumbnailRenderer } from "../thumbnails/renderer";
export type { ThumbnailRenderer } from "../thumbnails/renderer";
