import { IconDrawing } from "../components/Icons";

import { useThumbnail, useThumbnailService } from "./context";

import "./thumbnails.css";

export type ThumbnailSize = "sm" | "md" | "lg";

/**
 * A drawing's thumbnail (or a neutral placeholder while loading / when none).
 * Renders nothing without a service, so surfaces keep their text UI.
 */
export const Thumbnail = ({
  path,
  size,
  className,
}: {
  path: string;
  size: ThumbnailSize;
  className?: string;
}) => {
  const service = useThumbnailService();
  const state = useThumbnail(service ? path : null);
  if (!service) {
    return null;
  }
  const cls = `vault-thumb vault-thumb--${size}${
    className ? ` ${className}` : ""
  }`;
  if (state.status === "ready" && state.url) {
    return (
      <img
        className={cls}
        src={state.url}
        loading="lazy"
        decoding="async"
        draggable={false}
        alt=""
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
