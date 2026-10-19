import { ThumbnailProvider } from "./context";
import { DarkInvertProvider } from "./surfaces/darkInvert";
import { useVaultThumbnails } from "./useVaultThumbnails";

import type { MutableRefObject, ReactNode } from "react";
import type { VaultRepository } from "../vault/types";
import type { ThumbnailService } from "./service";
import type { ThumbnailStore } from "./store";

/**
 * Owns the vault's thumbnail service and provides it (and the dark-mode
 * invert flag) to every surface. The service lives here, not in the app
 * component, so creating it on vault open re-renders only this provider and
 * the surfaces that read it, not the whole app (`children` is unchanged).
 */
export const ThumbnailsRoot = ({
  store,
  repository,
  handle,
  win,
  appTheme,
  serviceRef,
  children,
}: {
  store: ThumbnailStore | null;
  repository: VaultRepository;
  handle: string | null;
  win: Window | null;
  appTheme: string;
  /** The live service for the host's non-React callers (save notices). */
  serviceRef: MutableRefObject<ThumbnailService | null>;
  children?: ReactNode;
}) => {
  const thumbnails = useVaultThumbnails({
    store,
    repository,
    handle,
    win,
    appTheme,
  });
  serviceRef.current = thumbnails.service;
  return (
    <ThumbnailProvider service={thumbnails.service}>
      <DarkInvertProvider value={thumbnails.darkInvert}>
        {children}
      </DarkInvertProvider>
    </ThumbnailProvider>
  );
};
