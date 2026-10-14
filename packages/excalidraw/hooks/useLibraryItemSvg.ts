import { exportToSvg } from "@excalidraw/utils/export";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  COLOR_PALETTE,
  THEME,
  getDisplayColorKey,
  subscribeDisplayColorTransform,
} from "@excalidraw/common";
import { hashElementsVersion } from "@excalidraw/element";

import type { Theme } from "@excalidraw/element/types";

import { atom, useAtom } from "../editor-jotai";

import type { LibraryItem } from "../types";

export type SvgCache = Map<LibraryItem["id"], SVGSVGElement>;

export const libraryItemSvgsCache = atom<SvgCache>(new Map());

/**
 * Previews are rendered the way the canvas shows elements right now: dark
 * mode and the host's display colour transform (e.g. theme sync) are applied
 * to the colours at export time (no CSS filter). Item data is untouched.
 */
const exportLibraryItemToSvg = async (
  elements: LibraryItem["elements"],
  theme: Theme,
) => {
  return await exportToSvg({
    elements,
    appState: {
      exportBackground: false,
      viewBackgroundColor: COLOR_PALETTE.white,
      exportWithDarkMode: theme === THEME.DARK,
    },
    files: null,
    renderEmbeddables: false,
    skipInliningFonts: true,
  });
};

/** Key of the on-screen colours; the component re-renders when it changes. */
export const useDisplayColorKey = () =>
  useSyncExternalStore(subscribeDisplayColorTransform, getDisplayColorKey);

// what each cache's previews were rendered for (theme + display colours)
const cacheColorKeys = new WeakMap<SvgCache, string>();
// elements version each cached preview was rendered from
const svgElementsVersions = new WeakMap<SVGSVGElement, number>();

/** Drops every cached preview rendered for other colours than `colorKey`. */
const syncCacheColorKey = (svgCache: SvgCache, colorKey: string) => {
  if (cacheColorKeys.get(svgCache) !== colorKey) {
    svgCache.clear();
    cacheColorKeys.set(svgCache, colorKey);
  }
};

/** Thinnest stroke shown in a scaled-down preview, in CSS pixels. */
export const PREVIEW_MIN_STROKE_PX = 1.25;

/**
 * Scaled-down previews turn normal strokes into hairlines (a 600px diagram
 * in a 70px tile draws a 2px line 0.23px wide). Raise strokes of the
 * rendered copy inside `node` to at least `minPx` on screen, like a
 * thumbnail would. Only the displayed copy changes, not the cached svg.
 */
export const thickenPreviewStrokes = (
  node: HTMLElement,
  minPx = PREVIEW_MIN_STROKE_PX,
) => {
  const svg = node.querySelector("svg");
  const viewBox = svg?.viewBox?.baseVal;
  if (!svg || !viewBox?.width || !viewBox.height) {
    return;
  }
  const { width, height } = svg.getBoundingClientRect();
  const scale = Math.min(width / viewBox.width, height / viewBox.height);
  if (!scale || scale * 2 >= minPx) {
    // not rendered (yet), or default strokes are visible anyway
    return;
  }
  const minWidth = minPx / scale;
  for (const el of svg.querySelectorAll("[stroke-width]")) {
    if (parseFloat(el.getAttribute("stroke-width")!) < minWidth) {
      el.setAttribute("stroke-width", `${minWidth}`);
    }
  }
};

export const useLibraryItemSvg = (
  id: LibraryItem["id"] | null,
  elements: LibraryItem["elements"] | undefined,
  svgCache: SvgCache,
  ref: React.RefObject<HTMLDivElement | null>,
  theme: Theme,
  /** false: don't render (yet), e.g. while scrolled out of view */
  enabled = true,
): SVGSVGElement | undefined => {
  const [svg, setSvg] = useState<SVGSVGElement>();
  const displayColorKey = useDisplayColorKey();

  useEffect(() => {
    if (!elements || !enabled) {
      return;
    }
    let cancelled = false;
    const render = async (version?: number) => {
      const exportedSvg = await exportLibraryItemToSvg(elements, theme);
      // TODO: should likely be removed for custom fonts
      exportedSvg.querySelector(".style-fonts")?.remove();
      if (id && version !== undefined) {
        svgElementsVersions.set(exportedSvg, version);
        svgCache.set(id, exportedSvg);
      }
      if (!cancelled) {
        setSvg(exportedSvg);
      }
    };
    if (id) {
      syncCacheColorKey(svgCache, `${theme}|${displayColorKey}`);
      const version = hashElementsVersion(elements);
      const cachedSvg = svgCache.get(id);
      if (cachedSvg && svgElementsVersions.get(cachedSvg) === version) {
        setSvg(cachedSvg);
      } else {
        render(version);
      }
    } else {
      // no id (pending elements selected on canvas): not cached
      render();
    }
    return () => {
      cancelled = true;
    };
  }, [id, elements, svgCache, theme, displayColorKey, enabled]);

  useEffect(() => {
    const node = ref.current;

    if (!node) {
      return;
    }

    if (svg) {
      node.innerHTML = svg.outerHTML;
      thickenPreviewStrokes(node);
    }

    return () => {
      node.innerHTML = "";
    };
  }, [svg, ref]);

  return svg;
};

export const useLibraryCache = () => {
  const [svgCache] = useAtom(libraryItemSvgsCache);

  const clearLibraryCache = () => svgCache.clear();

  const deleteItemsFromLibraryCache = (items: LibraryItem["id"][]) => {
    items.forEach((item) => svgCache.delete(item));
  };

  return {
    clearLibraryCache,
    deleteItemsFromLibraryCache,
    svgCache,
  };
};

// -----------------------------------------------------------------------------
// lazy rendering: one shared IntersectionObserver for all library previews

let viewportObserver: IntersectionObserver | null = null;
const onBecameVisible = new WeakMap<Element, () => void>();

const getViewportObserver = () => {
  if (!viewportObserver && typeof IntersectionObserver !== "undefined") {
    viewportObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onBecameVisible.get(entry.target)?.();
          }
        }
      },
      // render a little ahead of scrolling
      { rootMargin: "300px 0px" },
    );
  }
  return viewportObserver;
};

/**
 * True once the element has come near the viewport (then stays true).
 * Without IntersectionObserver (e.g. jsdom) everything counts as visible.
 */
export const useHasBeenVisible = (
  ref: React.RefObject<HTMLElement | null>,
): boolean => {
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const node = ref.current;
    const observer = getViewportObserver();
    if (visible || !node || !observer) {
      return;
    }
    onBecameVisible.set(node, () => setVisible(true));
    observer.observe(node);
    return () => {
      observer.unobserve(node);
      onBecameVisible.delete(node);
    };
  }, [ref, visible]);
  return visible;
};
