import { ThumbnailProvider } from "./context";
import { DarkInvertProvider } from "./surfaces/darkInvert";

import type { ReactNode } from "react";
import type { VaultThumbnails } from "./useVaultThumbnails";

/** Provides the service and the dark-mode invert flag to every surface. */
export const ThumbnailsRoot = ({
  thumbnails,
  children,
}: {
  thumbnails: VaultThumbnails;
  children?: ReactNode;
}) => (
  <ThumbnailProvider service={thumbnails.service}>
    <DarkInvertProvider value={thumbnails.darkInvert}>
      {children}
    </DarkInvertProvider>
  </ThumbnailProvider>
);
