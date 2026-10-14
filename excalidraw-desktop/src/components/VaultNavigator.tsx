import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getPreferences, updatePreferences } from "../vault/preferences";
import { SORT_LABELS, SORT_ORDERS, type SortOrder } from "../vault/sortOrder";
import { checkTreeDrop, getParentPath } from "../vault/treeStore";

import { useVaultTags } from "../tags/useVaultTags";

import { tagQuery } from "../tags/types";

import {
  IconChevronDown,
  IconChevronRight,
  IconChevronsUpDown,
  IconClose,
  IconCheck,
  IconCopy,
  IconDrawing,
  IconEdit,
  IconExport,
  IconFolder,
  IconFolderPlus,
  IconMore,
  IconMove,
  IconNewDrawing,
  IconPlus,
  IconRefresh,
  IconReveal,
  IconSearch,
  IconSettings,
  IconSort,
  IconTrash,
} from "./Icons";
import { SearchResults } from "./search/SearchResults";
import { TagChips } from "./tags/TagChips";
import { TagsPanel } from "./tags/TagsPanel";

import { ConfirmModal } from "./ConfirmModal";
import { MoveModal } from "./MoveModal";
import { RenameModal } from "./RenameModal";
import { ghostTransform, useTreeDrag } from "./tree/useTreeDrag";

import type { ReactNode } from "react";

import type { TreeNode } from "../vault/treeStore";

import type { DragSource } from "./tree/useTreeDrag";

import type { ElementMatch, VaultSearch } from "../search/types";

import type { VaultEntry, VaultInfo } from "../vault/types";

import type { ExplorerExportFormat } from "../export/exportFromFile";

const DEFAULT_WIDTH = 280;
const clampWidth = (value: number) =>
  Math.round(Math.min(480, Math.max(200, value || DEFAULT_WIDTH)));

interface VaultNavigatorProps {
  vault: VaultInfo;
  activePath: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenDrawing: (path: string) => void | Promise<void>;
  /** Vault-wide search backend; null = name-only search over the loaded tree. */
  search?: VaultSearch | null;
  onOpenSearchResult?: (
    path: string,
    match?: ElementMatch,
  ) => void | Promise<void>;
  /** Bump to focus and select the search input (Cmd+Shift+F). */
  searchFocusNonce?: number;
  onCreateDrawing: (parentPath: string, name: string) => void | Promise<void>;
  onCreateFolder: (parentPath: string, name: string) => void | Promise<void>;
  onRenameEntry: (path: string, newName: string) => void | Promise<void>;
  onMoveEntry: (
    sourcePath: string,
    destinationParentPath: string,
  ) => void | Promise<void>;
  onDuplicateDrawing: (path: string) => void | Promise<void>;
  onSaveAsTemplate?: (path: string) => void;
  onTrashEntry: (path: string) => void | Promise<void>;
  onRevealEntry: (path: string) => void | Promise<void>;
  /** Drawing rows: Export as PNG/SVG…, Save a copy… */
  onExportDrawing?: (
    path: string,
    format: ExplorerExportFormat,
  ) => void | Promise<void>;
  onSwitchVault: () => void | Promise<void>;
  treeNodes: TreeNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (folderPath: string) => void;
  onExpandFolder: (folderPath: string) => void;
  allIndexedEntries: VaultEntry[];
  isIndexing?: boolean;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
  /** False: "Move to Trash" acts immediately, without the dialog. */
  confirmDelete: boolean;
  /** Show tag chips after drawing names (default on). */
  showTagChips?: boolean;
  ownerDocument?: Document | null;
}

export const VaultNavigator = ({
  vault,
  activePath,
  collapsed,
  onToggleCollapse,
  onOpenDrawing,
  search = null,
  onOpenSearchResult,
  searchFocusNonce = 0,
  onCreateDrawing,
  onCreateFolder,
  onRenameEntry,
  onMoveEntry,
  onDuplicateDrawing,
  onSaveAsTemplate,
  onTrashEntry,
  onRevealEntry,
  onExportDrawing,
  onSwitchVault,
  treeNodes,
  expandedFolders,
  onToggleFolder,
  onExpandFolder,
  allIndexedEntries,
  isIndexing = false,
  onRefresh,
  onOpenSettings,
  sortOrder,
  onSortChange,
  confirmDelete,
  showTagChips = true,
  ownerDocument,
}: VaultNavigatorProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  // Modals state
  const [createKind, setCreateKind] = useState<"drawing" | "folder" | null>(
    null,
  );
  const [createParent, setCreateParent] = useState<string>("");
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<VaultEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<VaultEntry | null>(null);
  const [trashTarget, setTrashTarget] = useState<VaultEntry | null>(null);
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Trash now, or ask first when confirmation is on.
  const requestTrash = (entry: VaultEntry) => {
    if (confirmDelete) {
      setTrashTarget(entry);
    } else {
      void onTrashEntry(entry.path);
    }
  };

  const treeId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const win = asideRef.current?.ownerDocument.defaultView;
    setWidth(clampWidth(getPreferences(win).navigatorWidth));
  }, []);

  // Obsidian-style drag-to-resize; the navigator sits on the right edge.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const aside = asideRef.current;
    const win = aside?.ownerDocument.defaultView;
    if (!aside || !win) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = aside.getBoundingClientRect().width;
    let next = startWidth;
    aside.classList.add("vault-navigator--resizing");
    const onMove = (e: PointerEvent) => {
      next = clampWidth(startWidth + (startX - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onUp);
      aside.classList.remove("vault-navigator--resizing");
      updatePreferences({ navigatorWidth: next }, win);
    };
    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", onUp);
  };
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // Names already in a folder, from the loaded tree plus the search index.
  const namesInFolder = (folder: string): string[] => {
    const names = allIndexedEntries
      .filter((e) => getParentPath(e.path) === folder)
      .map((e) => e.name);
    const find = (nodes: TreeNode[]): TreeNode[] | undefined => {
      for (const node of nodes) {
        if (node.entry.path === folder) {
          return node.children;
        }
        if (node.children && folder.startsWith(`${node.entry.path}/`)) {
          return find(node.children);
        }
      }
      return undefined;
    };
    const children = folder === "" ? treeNodes : find(treeNodes);
    return names.concat((children ?? []).map((c) => c.entry.name));
  };

  const { drag, onRowPointerDown, pointerRef } = useTreeDrag({
    containerRef: treeContainerRef,
    ghostRef,
    enabled: !vault.readOnly && !searchQuery.trim(),
    check: (source, folder) =>
      checkTreeDrop(source, folder, {
        readOnly: vault.readOnly,
        existingNames: namesInFolder(folder),
      }),
    onDrop: (source, folder) => void onMoveEntry(source.path, folder),
    isExpanded: (folder) => expandedFolders.has(folder),
    onExpandFolder,
  });

  // Collect all known folders for move destination picker
  const allFolderPaths = Array.from(
    new Set([
      "",
      ...allIndexedEntries
        .filter((e) => e.kind === "folder")
        .map((e) => e.path),
    ]),
  );

  const isSearching = searchQuery.trim() !== "";
  const { tags, byPath: tagsByPath } = useVaultTags(search, vault.handle);
  const filterByTag = (key: string) => setSearchQuery(tagQuery(key));
  // Keep the panel during a plain tag filter so the active tag can be toggled off.
  const isTagFilter = tags.some((t) => tagQuery(t.tag) === searchQuery.trim());

  useEffect(() => {
    if (searchFocusNonce > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchFocusNonce]);

  // Flatten visible tree items for keyboard navigation
  const getVisibleItems = useCallback((): VaultEntry[] => {
    const list: VaultEntry[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        list.push(node.entry);
        if (
          node.entry.kind === "folder" &&
          expandedFolders.has(node.entry.path) &&
          node.children
        ) {
          traverse(node.children);
        }
      }
    };
    traverse(treeNodes);
    return list;
  }, [expandedFolders, treeNodes]);

  // Keyboard navigation within tree
  const handleTreeKeyDown = (e: React.KeyboardEvent) => {
    const visible = getVisibleItems();
    if (visible.length === 0) {
      return;
    }

    const currentIndex = visible.findIndex((item) => item.path === focusedPath);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const nextIndex =
          currentIndex < visible.length - 1 ? currentIndex + 1 : 0;
        setFocusedPath(visible[nextIndex].path);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prevIndex =
          currentIndex > 0 ? currentIndex - 1 : visible.length - 1;
        setFocusedPath(visible[prevIndex].path);
        break;
      }
      case "ArrowRight": {
        if (focusedPath) {
          const item = visible.find((i) => i.path === focusedPath);
          if (item?.kind === "folder") {
            e.preventDefault();
            if (!expandedFolders.has(item.path)) {
              onExpandFolder(item.path);
            }
          }
        }
        break;
      }
      case "ArrowLeft": {
        if (focusedPath) {
          const item = visible.find((i) => i.path === focusedPath);
          if (item?.kind === "folder" && expandedFolders.has(item.path)) {
            e.preventDefault();
            onToggleFolder(item.path);
          } else {
            const parent = getParentPath(focusedPath);
            if (parent !== undefined) {
              e.preventDefault();
              setFocusedPath(parent);
            }
          }
        }
        break;
      }
      case "Enter":
      case " ": {
        if (focusedPath) {
          e.preventDefault();
          const item = visible.find((i) => i.path === focusedPath);
          if (item) {
            if (item.kind === "folder") {
              onToggleFolder(item.path);
            } else {
              void onOpenDrawing(item.path);
            }
          }
        }
        break;
      }
      case "Delete":
      case "Backspace": {
        if (focusedPath && !vault.readOnly) {
          const item = visible.find((i) => i.path === focusedPath);
          if (item) {
            e.preventDefault();
            requestTrash(item);
          }
        }
        break;
      }
    }
  };

  // Create submission
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createKind || !createName.trim()) {
      return;
    }
    setCreateError(null);
    try {
      if (createKind === "drawing") {
        const fullDrawingName = createName.trim().endsWith(".excalidraw")
          ? createName.trim()
          : `${createName.trim()}.excalidraw`;
        await onCreateDrawing(createParent, fullDrawingName);
      } else {
        await onCreateFolder(createParent, createName.trim());
      }
      setCreateKind(null);
      setCreateName("");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside
      ref={asideRef}
      className={`vault-navigator ${
        collapsed ? "vault-navigator--collapsed" : ""
      }`}
      style={collapsed ? undefined : { width, flexBasis: width }}
      aria-label="Vault File Navigator"
      aria-hidden={collapsed}
      data-vault-path={vault.path}
    >
      {!collapsed && (
        <div
          className="vault-navigator__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize navigator"
          onPointerDown={startResize}
          onDoubleClick={() => {
            setWidth(DEFAULT_WIDTH);
            updatePreferences(
              { navigatorWidth: DEFAULT_WIDTH },
              asideRef.current?.ownerDocument.defaultView,
            );
          }}
        />
      )}
      <div className="vault-navigator__toolbar">
        {!vault.readOnly && (
          <>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={() => {
                setCreateParent("");
                setCreateKind("drawing");
                setCreateName("");
                setCreateError(null);
              }}
              title="New drawing"
              aria-label="New Drawing"
            >
              <IconNewDrawing />
            </button>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={() => {
                setCreateParent("");
                setCreateKind("folder");
                setCreateName("");
                setCreateError(null);
              }}
              title="New folder"
              aria-label="New Folder"
            >
              <IconFolderPlus />
            </button>
          </>
        )}
        {onRefresh && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onRefresh}
            title="Refresh files"
            aria-label="Refresh files"
          >
            <IconRefresh />
          </button>
        )}
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--icon"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setSortMenu({ x: box.right, y: box.bottom + 4 });
          }}
          title="Sort order"
          aria-label="Sort order"
          aria-haspopup="menu"
        >
          <IconSort />
        </button>
        <span className="vault-navigator__toolbar-spacer" />
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--icon"
          onClick={onToggleCollapse}
          title="Hide navigator"
          aria-label="Collapse Navigator"
        >
          <IconClose />
        </button>
      </div>

      {/* Search Input */}
      <div className="vault-search">
        <div className="vault-search__box">
          <IconSearch />
          <input
            ref={searchInputRef}
            type="text"
            className="vault-search__input"
            placeholder="Search drawings and text… (tag:#name)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // First Escape clears the query, the next one leaves the box.
                if (searchQuery) {
                  setSearchQuery("");
                } else {
                  e.currentTarget.blur();
                }
              }
            }}
          />
          {isIndexing && (
            <span className="vault-spinner" title="Indexing files..." />
          )}
          {searchQuery && (
            <button
              type="button"
              className="vault-search__clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <IconClose />
            </button>
          )}
        </div>
      </div>

      {(!isSearching || isTagFilter) && (
        <TagsPanel
          tags={tags}
          query={searchQuery}
          onQueryChange={setSearchQuery}
        />
      )}

      {/* Search Results or Tree View */}
      <div
        ref={treeContainerRef}
        className={`vault-tree-container ${
          drag?.targetFolder === "" ? "vault-tree-container--drop-root" : ""
        }`}
        role={isSearching ? undefined : "tree"}
        id={treeId}
        tabIndex={isSearching ? undefined : 0}
        onKeyDown={isSearching ? undefined : handleTreeKeyDown}
      >
        {isSearching ? (
          <SearchResults
            query={searchQuery.trim()}
            inputRef={searchInputRef}
            search={search}
            handle={vault.handle}
            allIndexedEntries={allIndexedEntries}
            activePath={activePath}
            onOpenDrawing={(path) =>
              void (onOpenSearchResult ?? onOpenDrawing)(path)
            }
            onOpenMatch={(path, match) =>
              void (onOpenSearchResult
                ? onOpenSearchResult(path, match)
                : onOpenDrawing(path))
            }
            onOpenFolder={(path) => {
              onExpandFolder(path);
              setSearchQuery("");
            }}
          />
        ) : (
          <div className="vault-tree-body">
            {treeNodes.length === 0 ? (
              <div className="vault-tree-empty">
                Vault is empty. Create your first drawing!
              </div>
            ) : (
              <TreeRenderer
                nodes={treeNodes}
                depth={0}
                activePath={activePath}
                focusedPath={focusedPath}
                expandedFolders={expandedFolders}
                readOnly={vault.readOnly}
                onSelect={(path, kind) => {
                  setFocusedPath(path);
                  if (kind === "drawing") {
                    void onOpenDrawing(path);
                  } else {
                    onToggleFolder(path);
                  }
                }}
                onToggleFolder={onToggleFolder}
                onNewInside={(folderPath, kind) => {
                  setCreateParent(folderPath);
                  setCreateKind(kind);
                  setCreateName("");
                  setCreateError(null);
                }}
                onOpenMenu={(entry, x, y) => setMenu({ entry, x, y })}
                onRowPointerDown={onRowPointerDown}
                dropTarget={drag?.allowed ? drag.targetFolder : null}
                dragSourcePath={drag?.source.path ?? null}
                tagsByPath={showTagChips ? tagsByPath : undefined}
                onFilterTag={filterByTag}
              />
            )}
            {/* Empty space below the rows: dropping here moves to the root. */}
            <div className="vault-tree-root-drop" aria-hidden="true">
              {drag && drag.targetFolder === "" && drag.allowed && (
                <span>Move to vault root</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Vault switcher and settings (Obsidian-style footer) */}
      <div className="vault-navigator__footer">
        <button
          type="button"
          className="vault-navigator__vault"
          onClick={() => void onSwitchVault()}
          title={`${vault.path}\nClick to open another vault`}
          aria-label="Close current vault and open another"
        >
          <span className="vault-navigator__vault-name">{vault.name}</span>
          <IconChevronsUpDown />
        </button>
        {onOpenSettings && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <IconSettings />
          </button>
        )}
      </div>

      {drag &&
        createPortal(
          <div
            ref={ghostRef}
            className="vault-tree-drag-ghost"
            data-allowed={drag.allowed ? "true" : "false"}
            style={{
              transform: ghostTransform(
                pointerRef.current.x,
                pointerRef.current.y,
              ),
            }}
            role="status"
            aria-live="polite"
          >
            <span className="vault-tree-drag-ghost__name">
              {drag.source.kind === "folder" ? <IconFolder /> : <IconDrawing />}
              {drag.source.name.replace(/\.excalidraw$/i, "")}
            </span>
            {drag.targetFolder !== null && (
              <span className="vault-tree-drag-ghost__hint">
                {drag.allowed
                  ? `Move to ${
                      drag.targetFolder
                        ? drag.targetFolder.split("/").pop()
                        : "vault root"
                    }`
                  : drag.reason}
              </span>
            )}
          </div>,
          (asideRef.current?.ownerDocument ?? ownerDocument ?? document).body,
        )}

      {sortMenu && (
        <MenuPopup
          x={sortMenu.x}
          y={sortMenu.y}
          label="Sort order"
          ownerDocument={asideRef.current?.ownerDocument ?? ownerDocument}
          onClose={() => setSortMenu(null)}
        >
          {SORT_ORDERS.map((order) => (
            <MenuItem
              key={order}
              label={SORT_LABELS[order]}
              checked={order === sortOrder}
              onSelect={() => {
                setSortMenu(null);
                onSortChange(order);
              }}
            />
          ))}
        </MenuPopup>
      )}

      {menu && (
        <RowMenu
          state={menu}
          readOnly={vault.readOnly}
          ownerDocument={asideRef.current?.ownerDocument ?? ownerDocument}
          onClose={() => setMenu(null)}
          onNewInside={(folderPath) => {
            setCreateParent(folderPath);
            setCreateKind("drawing");
            setCreateName("");
            setCreateError(null);
          }}
          onDuplicate={(entry) => void onDuplicateDrawing(entry.path)}
          onSaveAsTemplate={
            onSaveAsTemplate && ((entry) => onSaveAsTemplate(entry.path))
          }
          onRename={(entry) => setRenameTarget(entry)}
          onMove={(entry) => setMoveTarget(entry)}
          onReveal={(entry) => void onRevealEntry(entry.path)}
          onExport={
            onExportDrawing &&
            ((entry, format) => void onExportDrawing(entry.path, format))
          }
          onTrash={requestTrash}
        />
      )}

      {/* Create Modal */}
      {createKind && (
        <div
          className="vault-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCreateKind(null);
            }
          }}
        >
          <div className="vault-modal">
            <form onSubmit={handleCreateSubmit}>
              <div className="vault-modal__header">
                <h3 className="vault-modal__title">
                  New {createKind === "drawing" ? "Drawing" : "Folder"}
                  {createParent && ` in /${createParent}`}
                </h3>
                <button
                  type="button"
                  className="vault-btn vault-btn--ghost vault-btn--icon"
                  onClick={() => setCreateKind(null)}
                >
                  <IconClose />
                </button>
              </div>
              <div className="vault-modal__body">
                <div className="vault-field">
                  <label htmlFor="create-entry-name">Name</label>
                  <input
                    id="create-entry-name"
                    type="text"
                    className="vault-input"
                    autoFocus
                    value={createName}
                    onChange={(e) => {
                      setCreateName(e.target.value);
                      if (createError) {
                        setCreateError(null);
                      }
                    }}
                    placeholder={
                      createKind === "drawing" ? "My Drawing" : "Folder Name"
                    }
                  />
                  {createKind === "drawing" && (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--vault-text-faint)",
                      }}
                    >
                      Extension .excalidraw will be added automatically
                    </span>
                  )}
                  {createError && (
                    <div className="vault-error-text">{createError}</div>
                  )}
                </div>
              </div>
              <div className="vault-modal__footer">
                <button
                  type="button"
                  className="vault-btn"
                  onClick={() => setCreateKind(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="vault-btn vault-btn--primary"
                  disabled={!createName.trim()}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <RenameModal
          initialName={renameTarget.name}
          kind={renameTarget.kind}
          onRename={async (newName) => {
            await onRenameEntry(renameTarget.path, newName);
            setRenameTarget(null);
          }}
          onCancel={() => setRenameTarget(null)}
          ownerDocument={ownerDocument}
        />
      )}

      {/* Move Modal */}
      {moveTarget && (
        <MoveModal
          sourcePath={moveTarget.path}
          sourceKind={moveTarget.kind}
          folders={allFolderPaths}
          onMove={async (destFolder) => {
            await onMoveEntry(moveTarget.path, destFolder);
            setMoveTarget(null);
          }}
          onCancel={() => setMoveTarget(null)}
          ownerDocument={ownerDocument}
        />
      )}

      {/* Trash Confirm Modal */}
      {trashTarget && (
        <ConfirmModal
          title={`Delete ${
            trashTarget.kind === "drawing" ? "Drawing" : "Folder"
          }`}
          message={
            trashTarget.kind === "folder"
              ? `Move "${trashTarget.name}" to OS Trash? Note: Non-empty folders cannot be trashed to prevent losing drawings.`
              : `Move "${trashTarget.name}" to OS Trash?`
          }
          confirmLabel="Move to Trash"
          isDanger
          onConfirm={async () => {
            await onTrashEntry(trashTarget.path);
            setTrashTarget(null);
          }}
          onCancel={() => setTrashTarget(null)}
          ownerDocument={ownerDocument}
        />
      )}
    </aside>
  );
};

interface TreeRendererProps {
  nodes: TreeNode[];
  depth: number;
  activePath: string | null;
  focusedPath: string | null;
  expandedFolders: Set<string>;
  readOnly: boolean;
  onSelect: (path: string, kind: "folder" | "drawing") => void;
  onToggleFolder: (path: string) => void;
  onNewInside: (folderPath: string, kind: "folder" | "drawing") => void;
  onOpenMenu: (entry: VaultEntry, x: number, y: number) => void;
  onRowPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    entry: DragSource,
  ) => void;
  /** Folder highlighted as the drop target (only while a drop is allowed). */
  dropTarget: string | null;
  dragSourcePath: string | null;
  /** Tags per drawing path; undefined hides the chips. */
  tagsByPath?: Record<string, string[]>;
  onFilterTag: (key: string) => void;
}

const TreeRenderer = ({
  nodes,
  depth,
  activePath,
  focusedPath,
  expandedFolders,
  readOnly,
  onSelect,
  onToggleFolder,
  onNewInside,
  onOpenMenu,
  onRowPointerDown,
  dropTarget,
  dragSourcePath,
  tagsByPath,
  onFilterTag,
}: TreeRendererProps) => {
  return (
    <>
      {nodes.map((node) => {
        const entry = node.entry;
        const isFolder = entry.kind === "folder";
        const isExpanded = expandedFolders.has(entry.path);
        const isActive = entry.path === activePath;
        const isFocused = entry.path === focusedPath;
        const isDropTarget = isFolder && dropTarget === entry.path;
        const isDragSource = dragSourcePath === entry.path;

        return (
          <div key={entry.path} style={{ display: "contents" }}>
            <div
              className={`vault-tree-item ${
                isActive ? "vault-tree-item--active" : ""
              } ${isFocused ? "vault-tree-item--focused" : ""} ${
                isDropTarget ? "vault-tree-item--drop-target" : ""
              } ${isDragSource ? "vault-tree-item--drag-source" : ""}`}
              style={{ "--depth": depth } as React.CSSProperties}
              data-tree-path={entry.path}
              data-tree-kind={entry.kind}
              onPointerDown={(e) => onRowPointerDown(e, entry)}
              role="treeitem"
              aria-expanded={isFolder ? isExpanded : undefined}
              aria-selected={isActive}
              tabIndex={isFocused ? 0 : -1}
              onClick={() => onSelect(entry.path, entry.kind)}
              onContextMenu={(e) => {
                e.preventDefault();
                onOpenMenu(entry, e.clientX, e.clientY);
              }}
            >
              <div className="vault-tree-item__main">
                {isFolder ? (
                  <span
                    className="vault-tree-item__toggle"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFolder(entry.path);
                    }}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
                  </span>
                ) : (
                  <span className="vault-tree-item__icon">
                    <IconDrawing />
                  </span>
                )}

                <span className="vault-tree-item__name" title={entry.path}>
                  {isFolder
                    ? entry.name
                    : entry.name.replace(/\.excalidraw$/i, "")}
                </span>
                {!isFolder && tagsByPath?.[entry.path] && (
                  <TagChips
                    tags={tagsByPath[entry.path]}
                    onFilter={onFilterTag}
                  />
                )}
              </div>

              <div
                className="vault-tree-item__actions"
                onClick={(e) => e.stopPropagation()}
              >
                {isFolder && !readOnly && (
                  <button
                    type="button"
                    className="vault-tree-action-btn"
                    title="New drawing in this folder"
                    onClick={() => onNewInside(entry.path, "drawing")}
                    aria-label="New drawing in folder"
                  >
                    <IconPlus />
                  </button>
                )}
                <button
                  type="button"
                  className="vault-tree-action-btn"
                  title="More actions"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    onOpenMenu(entry, box.right, box.bottom + 4);
                  }}
                >
                  <IconMore />
                </button>
              </div>
            </div>

            {isFolder && isExpanded && node.children && (
              <TreeRenderer
                nodes={node.children}
                depth={depth + 1}
                activePath={activePath}
                focusedPath={focusedPath}
                expandedFolders={expandedFolders}
                readOnly={readOnly}
                onSelect={onSelect}
                onToggleFolder={onToggleFolder}
                onNewInside={onNewInside}
                onOpenMenu={onOpenMenu}
                onRowPointerDown={onRowPointerDown}
                dropTarget={dropTarget}
                dragSourcePath={dragSourcePath}
                tagsByPath={tagsByPath}
                onFilterTag={onFilterTag}
              />
            )}
          </div>
        );
      })}
    </>
  );
};

interface RowMenuState {
  entry: VaultEntry;
  x: number;
  y: number;
}

interface RowMenuProps {
  state: RowMenuState;
  readOnly: boolean;
  ownerDocument?: Document | null;
  onClose: () => void;
  onNewInside: (folderPath: string) => void;
  onDuplicate: (entry: VaultEntry) => void;
  onSaveAsTemplate?: (entry: VaultEntry) => void;
  onRename: (entry: VaultEntry) => void;
  onMove: (entry: VaultEntry) => void;
  onReveal: (entry: VaultEntry) => void;
  onExport?: (entry: VaultEntry, format: ExplorerExportFormat) => void;
  onTrash: (entry: VaultEntry) => void;
}

const MENU_WIDTH = 200;

interface MenuPopupProps {
  x: number;
  y: number;
  label: string;
  ownerDocument?: Document | null;
  onClose: () => void;
  children: ReactNode;
}

/** Positioned `vault-menu` with focus, arrow-key and dismiss handling. */
const MenuPopup = ({
  x,
  y,
  label,
  ownerDocument,
  onClose,
  children,
}: MenuPopupProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = menuRef.current?.ownerDocument ?? ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role^='menuitem']")
      ?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      event.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          "[role^='menuitem']",
        ) ?? [],
      );
      const index = items.indexOf(doc.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("blur", onClose);
    win.addEventListener("resize", onClose);
    return () => {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("blur", onClose);
      win.removeEventListener("resize", onClose);
    };
  }, [onClose, ownerDocument]);

  const win = ownerDocument?.defaultView;
  const maxX = (win?.innerWidth ?? 1280) - MENU_WIDTH - 8;
  const maxY = (win?.innerHeight ?? 800) - 220;
  const left = Math.max(8, Math.min(x - MENU_WIDTH, maxX));
  const top = Math.max(8, Math.min(y, maxY));

  return (
    <div
      ref={menuRef}
      className="vault-menu"
      role="menu"
      aria-label={label}
      style={{ left, top, width: MENU_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
};

interface MenuItemProps {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  checked?: boolean;
  onSelect: () => void;
}

const MenuItem = ({
  label,
  icon,
  danger,
  checked,
  onSelect,
}: MenuItemProps) => (
  <button
    type="button"
    role={checked === undefined ? "menuitem" : "menuitemradio"}
    aria-checked={checked}
    className={`vault-menu__item ${danger ? "vault-menu__item--danger" : ""}`}
    onClick={onSelect}
  >
    {icon}
    <span>{label}</span>
    {checked && <IconCheck className="vault-menu__check" />}
  </button>
);

/** Row actions shown from the "More actions" button or a right-click. */
const RowMenu = ({
  state,
  readOnly,
  ownerDocument,
  onClose,
  onNewInside,
  onDuplicate,
  onSaveAsTemplate,
  onRename,
  onMove,
  onReveal,
  onExport,
  onTrash,
}: RowMenuProps) => {
  const { entry } = state;
  const isFolder = entry.kind === "folder";

  const item = (
    label: string,
    icon: ReactNode,
    action: () => void,
    danger = false,
  ) => (
    <MenuItem
      label={label}
      icon={icon}
      danger={danger}
      onSelect={() => {
        onClose();
        action();
      }}
    />
  );

  return (
    <MenuPopup
      x={state.x}
      y={state.y}
      label={`Actions for ${entry.name}`}
      ownerDocument={ownerDocument}
      onClose={onClose}
    >
      {isFolder &&
        !readOnly &&
        item("New drawing here", <IconNewDrawing />, () =>
          onNewInside(entry.path),
        )}
      {!isFolder &&
        !readOnly &&
        item("Duplicate", <IconCopy />, () => onDuplicate(entry))}
      {!isFolder &&
        onSaveAsTemplate &&
        item("Save as template…", <IconCopy />, () => onSaveAsTemplate(entry))}
      {!readOnly && item("Rename", <IconEdit />, () => onRename(entry))}
      {!readOnly && item("Move to…", <IconMove />, () => onMove(entry))}
      {item("Reveal in file manager", <IconReveal />, () => onReveal(entry))}
      {!isFolder && onExport && (
        <>
          <div className="vault-menu__separator" role="separator" />
          {item("Export as PNG…", <IconExport />, () => onExport(entry, "png"))}
          {item("Export as SVG…", <IconExport />, () => onExport(entry, "svg"))}
          {item("Save a copy…", <IconExport />, () => onExport(entry, "copy"))}
        </>
      )}
      {!readOnly && (
        <>
          <div className="vault-menu__separator" role="separator" />
          {item("Move to Trash", <IconTrash />, () => onTrash(entry), true)}
        </>
      )}
    </MenuPopup>
  );
};
