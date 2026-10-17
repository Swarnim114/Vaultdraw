import {
  createElement,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { LinkPreviewController } from "./LinkPreviewController";
import { cardPosition, folderLabel, modifierLabel, nameOfPath } from "./format";

import type { ReactNode } from "react";

import type { LinkResolver } from "../../../links/resolve";
import type { HoverPreview, OpenModifier } from "../../../links/types";
import type { ShownLink } from "./LinkPreviewController";
import type { LinkPreviewCardProps } from "./LinkPreviewCard";
import type { PreviewThumbnails, ReadDrawing } from "./previewThumbnails";

const LinkPreviewCard = lazy(() => import("./LinkPreviewCard"));

export interface UseLinkPreviewOptions {
  api: ExcalidrawImperativeAPI | null;
  containerEl: HTMLElement | null;
  mode: HoverPreview;
  modifier: OpenModifier;
  resolver: LinkResolver;
  currentPath: string | null;
  readDrawing?: ReadDrawing;
}

/** Hover preview of `[[links]]` in canvas text; returns the overlay to render in the host. */
export function useLinkPreview(opts: UseLinkPreviewOptions): ReactNode {
  const { containerEl, mode } = opts;
  const live = useRef(opts);
  live.current = opts;
  const [card, setCard] = useState<LinkPreviewCardProps | null>(null);

  useEffect(() => {
    if (!containerEl || mode === "off") {
      return;
    }
    let token = 0;
    let thumbs: PreviewThumbnails | null = null;

    const loadThumbnail = async (path: string, t: number) => {
      const read = live.current.readDrawing;
      if (!read) {
        return;
      }
      if (!thumbs) {
        const mod = await import("./previewThumbnails");
        thumbs ??= mod.createPreviewThumbnails();
      }
      const url = await thumbs.get(path, read);
      if (t === token) {
        setCard((c) => (c ? { ...c, thumbnail: url } : c));
      }
    };

    const onShow = (link: ShownLink | null) => {
      const t = ++token;
      if (!link) {
        setCard(null);
        return;
      }
      const { resolver, currentPath, modifier } = live.current;
      const path = resolver.resolveTarget(currentPath ?? "", link.target).path;
      const pos = cardPosition(
        link.rects,
        link.lineHeight,
        containerEl.getBoundingClientRect(),
      );
      setCard({
        target: link.target,
        name: path ? nameOfPath(path) : null,
        folder: path ? folderLabel(path) : null,
        thumbnail: undefined,
        modifierLabel: modifierLabel(modifier),
        left: pos.left,
        top: pos.top,
      });
      if (path) {
        void loadThumbnail(path, t);
      }
    };

    const controller = new LinkPreviewController({
      container: containerEl,
      getApi: () => live.current.api,
      getMode: () => live.current.mode,
      getModifier: () => live.current.modifier,
      onShow,
    });
    controller.start();
    return () => {
      controller.stop();
      token++;
      thumbs?.clear();
      setCard(null);
    };
  }, [containerEl, mode]);

  if (!card) {
    return null;
  }
  return createElement(
    Suspense,
    { fallback: null },
    createElement(LinkPreviewCard, card),
  );
}
