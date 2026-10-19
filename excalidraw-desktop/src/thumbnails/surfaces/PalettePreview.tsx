import { useEffect, useState } from "react";

import { useThumbnailService } from "../context";
import { Thumbnail } from "../Thumbnail";

import { useThumbDarkClass } from "./darkInvert";

import "./PalettePreview.css";

export const PREVIEW_DEBOUNCE_MS = 80;

/**
 * Preview of the highlighted drawing beside the Cmd+P palette (files mode).
 * Follows the highlight after an 80 ms pause so arrow-key bursts cost nothing.
 * CSS hides it when the window is too narrow to fit beside the palette.
 */
export const PalettePreview = ({ path }: { path: string | null }) => {
  const service = useThumbnailService();
  const dark = useThumbDarkClass();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (path === null) {
      setShown(null);
      return;
    }
    const timer = setTimeout(() => setShown(path), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [path]);
  if (!service || shown === null) {
    return null;
  }
  return (
    <div
      className={`vault-palette-preview ${dark}`}
      data-testid="palette-preview"
      aria-hidden="true"
    >
      <Thumbnail key={shown} path={shown} size="lg" />
    </div>
  );
};
