import clsx from "clsx";
import React, { memo, useEffect, useState } from "react";

import type {
  ExcalidrawElement,
  NonDeleted,
  Theme,
} from "@excalidraw/element/types";

import { useTransition } from "../hooks/useTransition";

import { EmptyLibraryUnit, LibraryUnit } from "./LibraryUnit";

import type { SvgCache } from "../hooks/useLibraryItemSvg";
import type { LibraryItem } from "../types";
import type { ReactNode } from "react";

type LibraryOrPendingItem = readonly (
  | LibraryItem
  | /* pending library item */ {
      id: null;
      elements: readonly NonDeleted<ExcalidrawElement>[];
      files?: LibraryItem["files"];
    }
)[];

interface Props {
  items: LibraryOrPendingItem;
  onClick: (id: LibraryItem["id"] | null) => void;
  onItemSelectToggle: (id: LibraryItem["id"], event: React.MouseEvent) => void;
  onItemDrag: (id: LibraryItem["id"], event: React.DragEvent) => void;
  isItemSelected: (id: LibraryItem["id"] | null) => boolean;
  svgCache: SvgCache;
  itemsRenderedPerBatch: number;
  /** larger items with their name below */
  showNames?: boolean;
  theme: Theme;
  /** item whose name is being edited */
  renamingId?: LibraryItem["id"] | null;
  /** set: names are editable (see LibraryUnit) */
  onRenameStart?: (id: LibraryItem["id"]) => void;
  onRenameEnd?: (id: LibraryItem["id"] | null, name: string | null) => void;
  /** the pending (add) tile shows its name field */
  pendingNaming?: boolean;
  onItemContextMenu?: (id: LibraryItem["id"]) => void;
}

export const LibraryMenuSectionGrid = ({
  children,
  showNames,
}: {
  children: ReactNode;
  /** fewer columns, for items rendered with `showNames` */
  showNames?: boolean;
}) => {
  return (
    <div
      className={clsx("library-menu-items-container__grid", {
        "library-menu-items-container__grid--named": showNames,
      })}
    >
      {children}
    </div>
  );
};

export const LibraryMenuSection = memo(
  ({
    items,
    onItemSelectToggle,
    onItemDrag,
    isItemSelected,
    onClick,
    svgCache,
    itemsRenderedPerBatch,
    showNames,
    theme,
    renamingId,
    onRenameStart,
    onRenameEnd,
    onItemContextMenu,
    pendingNaming,
  }: Props) => {
    const [, startTransition] = useTransition();
    const [index, setIndex] = useState(0);

    useEffect(() => {
      if (index < items.length) {
        startTransition(() => {
          setIndex(index + itemsRenderedPerBatch);
        });
      }
    }, [index, items.length, startTransition, itemsRenderedPerBatch]);

    return (
      <>
        {items.map((item, i) => {
          return i < index ? (
            <LibraryUnit
              elements={item?.elements}
              files={item?.files}
              isPending={!item?.id && !!item?.elements}
              onClick={onClick}
              svgCache={svgCache}
              id={item?.id}
              name={"name" in item ? item.name : undefined}
              showName={showNames}
              theme={theme}
              renaming={item.id ? item.id === renamingId : !!pendingNaming}
              onRenameStart={onRenameStart}
              onRenameEnd={onRenameEnd}
              onContextMenu={onItemContextMenu}
              selected={isItemSelected(item.id)}
              onToggle={onItemSelectToggle}
              onDrag={onItemDrag}
              key={item?.id ?? i}
            />
          ) : (
            <EmptyLibraryUnit key={i} showName={showNames} />
          );
        })}
      </>
    );
  },
);
