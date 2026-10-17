/**
 * Mounts the link styler for one editor: `[[links]]` in text drawn with the
 * link colour. Zero per-frame cost (see linkStyler.ts). Only the editor that
 * installed the global styler can remove it.
 */
import { useEffect, useRef } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { LinkStyler } from "./linkStyler";

import type { LinkResolver } from "../../../links/resolve";

export type UseLinkStylingOptions = {
  api: ExcalidrawImperativeAPI | null;
  enabled: boolean;
  /** "accent" or "#rrggbb". */
  linkColor: string;
  resolver: LinkResolver;
  currentPath: string | null;
};

export function useLinkStyling(opts: UseLinkStylingOptions): void {
  const { api, enabled, linkColor, resolver, currentPath } = opts;
  const apiRef = useRef(api);
  apiRef.current = api;
  const styler = useRef<LinkStyler | null>(null);

  useEffect(() => {
    const s = new LinkStyler({
      repaint: () => {
        const a = apiRef.current;
        a?.updateScene({
          elements: a.getSceneElementsIncludingDeleted(),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      },
    });
    styler.current = s;
    return () => {
      s.dispose();
      styler.current = null;
    };
  }, []);

  useEffect(() => {
    styler.current?.update({
      enabled: enabled && api !== null,
      linkColor,
      resolver,
      currentPath,
    });
  }, [api, enabled, linkColor, resolver, currentPath]);
}
