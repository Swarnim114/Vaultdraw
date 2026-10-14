import clsx from "clsx";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  COLOR_PALETTE,
  KEYS,
  THEME,
  applyCanvasBackgroundFilter,
} from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { atom } from "../editor-jotai";
import {
  thickenPreviewStrokes,
  useDisplayColorKey,
  useHasBeenVisible,
  useLibraryItemSvg,
} from "../hooks/useLibraryItemSvg";
import { t } from "../i18n";

import { useEditorInterface, useExcalidrawContainer } from "./App";
import { CheckboxItem } from "./CheckboxItem";
import { PlusIcon } from "./icons";
import { hideTooltip, showTooltip } from "./Tooltip";

import "./LibraryUnit.scss";

import type { LibraryItem } from "../types";
import type { SvgCache } from "../hooks/useLibraryItemSvg";

/** Id of the library item whose name is being edited (named items only). */
export const libraryItemRenamingAtom = atom<LibraryItem["id"] | null>(null);

/**
 * Adding to the library asks for a name first (named items only): the
 * section whose add tile shows the name field ("" without sections).
 */
export const libraryAddNamingAtom = atom<string | null>(null);

export const LIBRARY_ITEM_NAME_MAX_LENGTH = 200;
const HOVER_PREVIEW_DELAY = 500;
const HOVER_PREVIEW_SIZE = 240;
const HOVER_PREVIEW_GAP = 12;

/** On-screen canvas colour, so previews look like the item on the canvas. */
const useCanvasColor = (theme: Theme) => {
  // re-render when the host's display colours change
  useDisplayColorKey();
  return applyCanvasBackgroundFilter(COLOR_PALETTE.white, theme === THEME.DARK);
};

/** Places the preview beside the tile (never over it), inside the editor. */
export const getHoverPreviewPosition = (
  tile: Pick<DOMRect, "left" | "right" | "top" | "height">,
  container: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  size = HOVER_PREVIEW_SIZE,
) => {
  const fitsLeft = tile.left - HOVER_PREVIEW_GAP - size >= container.left;
  const left = fitsLeft
    ? tile.left - HOVER_PREVIEW_GAP - size
    : Math.min(tile.right + HOVER_PREVIEW_GAP, container.right - size);
  const top = Math.max(
    container.top + 8,
    Math.min(
      tile.top + tile.height / 2 - size / 2,
      container.bottom - size - 8,
    ),
  );
  return { left: left - container.left, top: top - container.top };
};

const LibraryUnitHoverPreview = ({
  svg,
  tile,
  canvasColor,
}: {
  svg: SVGSVGElement;
  tile: HTMLElement;
  canvasColor: string;
}) => {
  const { container } = useExcalidrawContainer();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !container) {
      return;
    }
    const position = getHoverPreviewPosition(
      tile.getBoundingClientRect(),
      container.getBoundingClientRect(),
    );
    node.style.left = `${position.left}px`;
    node.style.top = `${position.top}px`;
    node.innerHTML = svg.outerHTML;
    thickenPreviewStrokes(node, 1);
  }, [svg, tile, container]);

  if (!container) {
    return null;
  }
  return createPortal(
    <div
      ref={ref}
      className="library-unit__hover-preview"
      data-testid="library-item-hover-preview"
      style={{
        width: HOVER_PREVIEW_SIZE,
        height: HOVER_PREVIEW_SIZE,
        backgroundColor: canvasColor,
      }}
    />,
    container,
  );
};

/** Inline name field. A name is required: empty is the same as cancel. */
const LibraryUnitNameInput = ({
  name,
  onCommit,
}: {
  name: string;
  /** trimmed, non-empty name; null: cancelled */
  onCommit: (name: string | null) => void;
}) => {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (!done.current) {
      done.current = true;
      onCommit(next?.trim() || null);
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Native listener on the input itself: the editor handles keys on its
  // container (Escape deselects, the sidebar closes), which runs before
  // React's root listener could stop the event.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === KEYS.ENTER) {
        event.preventDefault();
        // required: Enter on an empty field does nothing
        if (input.value.trim()) {
          finishRef.current(input.value);
        }
      } else if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        finishRef.current(null);
      }
    };
    input.addEventListener("keydown", onKeyDown);
    return () => input.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <input
      ref={inputRef}
      className="library-unit__name-input"
      data-testid="library-item-name-input"
      aria-label={t("library.itemName")}
      placeholder={t("library.itemNamePlaceholder")}
      value={value}
      maxLength={LIBRARY_ITEM_NAME_MAX_LENGTH}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
    />
  );
};

export const LibraryUnit = memo(
  ({
    id,
    name,
    showName,
    elements,
    isPending,
    onClick,
    selected,
    onToggle,
    onDrag,
    svgCache,
    theme,
    renaming,
    onRenameStart,
    onRenameEnd,
    onContextMenu,
  }: {
    id: LibraryItem["id"] | /** for pending item */ null;
    name?: LibraryItem["name"];
    /** render larger, with the name below the item */
    showName?: boolean;
    elements?: LibraryItem["elements"];
    isPending?: boolean;
    onClick: (id: LibraryItem["id"] | null) => void;
    selected: boolean;
    onToggle: (id: string, event: React.MouseEvent) => void;
    onDrag: (id: string, event: React.DragEvent) => void;
    svgCache: SvgCache;
    theme: Theme;
    /** the name is being edited */
    renaming?: boolean;
    /** set (with onRenameEnd): names are editable and tiles get a hover
     *  preview */
    onRenameStart?: (id: LibraryItem["id"]) => void;
    /** name null: cancelled. id null: the pending (add) tile was named. */
    onRenameEnd?: (id: LibraryItem["id"] | null, name: string | null) => void;
    onContextMenu?: (id: LibraryItem["id"]) => void;
  }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    const tileRef = useRef<HTMLDivElement | null>(null);
    const visible = useHasBeenVisible(tileRef);
    const svg = useLibraryItemSvg(id, elements, svgCache, ref, theme, visible);
    const canvasColor = useCanvasColor(theme);

    const [isHovered, setIsHovered] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const previewTimer = useRef(0);
    const isMobile = useEditorInterface().formFactor === "phone";
    const hasName = !!name?.trim();
    const editable = !!(id && elements && onRenameStart && onRenameEnd);
    const hoverPreview = editable && showName && !isMobile && !renaming;

    const hidePreview = () => {
      window.clearTimeout(previewTimer.current);
      setShowPreview(false);
    };

    useEffect(() => {
      if (!showPreview) {
        return;
      }
      // the tile moves away under the preview
      const hide = () => setShowPreview(false);
      window.addEventListener("scroll", hide, true);
      return () => window.removeEventListener("scroll", hide, true);
    }, [showPreview]);

    useEffect(() => () => window.clearTimeout(previewTimer.current), []);

    const adder = isPending && (
      <div className="library-unit__adder">{PlusIcon}</div>
    );

    return (
      <div
        ref={tileRef}
        className={clsx("library-unit", {
          "library-unit__active": elements,
          "library-unit--hover": elements && isHovered,
          "library-unit--selected": selected,
          "library-unit--skeleton": !svg,
          "library-unit--named": showName,
        })}
        data-testid={id ? `library-unit-${id}` : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={
          id && elements && onContextMenu
            ? (event) => {
                event.preventDefault();
                hidePreview();
                onContextMenu(id);
              }
            : undefined
        }
        // pointer (not mouse) events so that touch taps don't leave the
        // tooltip behind (pointerdown right after pointerenter cancels it)
        onPointerEnter={
          hasName && !showName
            ? (event) => {
                showTooltip(event.currentTarget, name!, {
                  delay: true,
                  position: "top",
                });
              }
            : undefined
        }
        onPointerLeave={hasName && !showName ? hideTooltip : undefined}
        onPointerDown={hasName && !showName ? hideTooltip : undefined}
      >
        <div
          className={clsx("library-unit__dragger", {
            "library-unit__pulse": !!isPending,
          })}
          // svg is rendered into `ref` (replacing its contents)
          ref={showName ? undefined : ref}
          draggable={!!elements}
          onPointerEnter={
            hoverPreview
              ? () => {
                  window.clearTimeout(previewTimer.current);
                  previewTimer.current = window.setTimeout(
                    () => setShowPreview(true),
                    HOVER_PREVIEW_DELAY,
                  );
                }
              : undefined
          }
          onPointerLeave={hoverPreview ? hidePreview : undefined}
          onPointerDown={hoverPreview ? hidePreview : undefined}
          onClick={
            !!elements || !!isPending
              ? (event) => {
                  if (id && event.shiftKey) {
                    onToggle(id, event);
                  } else {
                    onClick(id);
                  }
                }
              : undefined
          }
          onDragStart={(event) => {
            hidePreview();
            if (!id) {
              event.preventDefault();
              return;
            }
            setIsHovered(false);
            onDrag(id, event);
          }}
        >
          {showName && (
            <div
              className="library-unit__preview"
              ref={ref}
              style={{ backgroundColor: canvasColor }}
            />
          )}
        </div>
        {showName &&
          (renaming && onRenameEnd && (editable || isPending) ? (
            <LibraryUnitNameInput
              name={name ?? ""}
              onCommit={(next) => onRenameEnd(id, next)}
            />
          ) : (
            <div
              className={clsx("library-unit__name", {
                "library-unit__name--untitled": !hasName,
              })}
              data-testid="library-item-name"
              onPointerEnter={(event) => {
                const nameEl = event.currentTarget;
                // full name in a tooltip when it's ellipsized
                if (hasName && nameEl.scrollWidth > nameEl.clientWidth) {
                  showTooltip(nameEl, name!, { delay: true, position: "top" });
                }
              }}
              onPointerLeave={hideTooltip}
              onDoubleClick={
                editable
                  ? () => {
                      hideTooltip();
                      onRenameStart!(id!);
                    }
                  : undefined
              }
            >
              {isPending ? "" : hasName ? name : t("library.untitledItem")}
            </div>
          ))}
        {adder}
        {id && elements && (isHovered || isMobile || selected) && (
          <CheckboxItem
            checked={selected}
            onChange={(checked, event) => onToggle(id, event)}
            className="library-unit__checkbox"
          />
        )}
        {showPreview && svg && tileRef.current && (
          <LibraryUnitHoverPreview
            svg={svg}
            tile={tileRef.current}
            canvasColor={canvasColor}
          />
        )}
      </div>
    );
  },
);

export const EmptyLibraryUnit = ({ showName }: { showName?: boolean }) => (
  <div
    className={clsx("library-unit library-unit--skeleton", {
      "library-unit--named": showName,
    })}
  />
);
