import { useRef, useState } from "react";

import { IconDrawing } from "../components/Icons";

import { useThumbnail, useThumbnailService } from "./context";

import "./thumbnails.css";

import type { Priority } from "./queue";
import type { ThumbState } from "./service";

export type ThumbnailSize = "sm" | "md" | "lg";

/**
 * A drawing's thumbnail (or a neutral placeholder while loading / when none).
 * Renders nothing without a service, so surfaces keep their text UI.
 */
export const Thumbnail = ({
  path,
  size,
  className,
  priority = "visible",
}: {
  path: string;
  size: ThumbnailSize;
  className?: string;
  priority?: Priority;
}) => {
  const service = useThumbnailService();
  const state = useThumbnail(service ? path : null, priority);
  // The state object whose image failed to load (evicted file / cleared cache).
  const [broken, setBroken] = useState<ThumbState | null>(null);
  const retriedUrl = useRef<string | null>(null);
  if (!service) {
    return null;
  }
  const cls = `vault-thumb vault-thumb--${size}${
    className ? ` ${className}` : ""
  }`;
  if (state.status === "ready" && state.url && state !== broken) {
    return (
      <img
        className={cls}
        src={state.url}
        loading="lazy"
        decoding="async"
        draggable={false}
        alt=""
        onError={() => {
          setBroken(state);
          if (retriedUrl.current !== state.url) {
            retriedUrl.current = state.url; // one re-check per url: no loops
            service.refresh(path);
          }
        }}
      />
    );
  }
  return (
    <span
      className={`${cls} vault-thumb--placeholder`}
      data-state={state.status}
      aria-hidden="true"
    >
      <IconDrawing />
    </span>
  );
};
