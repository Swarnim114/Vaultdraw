import { createContext, useContext, useEffect, useState } from "react";

import { THUMB_NONE } from "./service";

import type { ReactNode } from "react";
import type { Priority } from "./queue";
import type { ThumbState, ThumbnailService } from "./service";

const ThumbnailContext = createContext<ThumbnailService | null>(null);

export const ThumbnailProvider = ({
  service,
  children,
}: {
  service: ThumbnailService | null;
  children?: ReactNode;
}) => (
  <ThumbnailContext.Provider value={service}>
    {children}
  </ThumbnailContext.Provider>
);

/** The service, or null when thumbnails are off / not provided (text UI). */
export const useThumbnailService = () => useContext(ThumbnailContext);

/** Thumbnail state of `path` (null path or no service = none). */
export const useThumbnail = (
  path: string | null,
  priority?: Priority,
): ThumbState => {
  const service = useThumbnailService();
  const [state, setState] = useState<ThumbState>(THUMB_NONE);
  useEffect(() => {
    if (!service || path === null) {
      setState(THUMB_NONE);
      return;
    }
    return service.watch(path, setState, { priority });
  }, [service, path, priority]);
  return service && path !== null ? state : THUMB_NONE;
};
