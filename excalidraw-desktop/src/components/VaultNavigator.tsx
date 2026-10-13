import { useCallback, useEffect, useId, useRef, useState } from "react";

import { getPreferences, updatePreferences } from "../vault/preferences";
import { getBaseName, getParentPath, searchEntries } from "../vault/treeStore";

import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCopy,
  IconDrawing,
  IconEdit,
  IconFolder,
  IconMove,
  IconPlus,
  IconRefresh,
  IconReveal,
  IconSearch,
  IconSettings,
  IconTrash,
} from "./Icons";
import { ConfirmModal } from "./ConfirmModal";
import { MoveModal } from "./MoveModal";
import { RenameModal } from "./RenameModal";

import type { TreeNode } from "../vault/treeStore";

import type { VaultEntry, VaultInfo } from "../vault/types";

const DEFAULT_WIDTH = 280;
const clampWidth = (value: number) =>
  Math.round(Math.min(480, Math.max(200, value || DEFAULT_WIDTH)));

interface VaultNavigatorProps {
  vault: VaultInfo;
  activePath: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenDrawing: (path: string) => void | Promise<void>;
  onCreateDrawing: (parentPath: string, name: string) => void | Promise<void>;
  onCreateFolder: (parentPath: string, name: string) => void | Promise<void>;
  onRenameEntry: (path: string, newName: string) => void | Promise<void>;
  onMoveEntry: (
    sourcePath: string,
    destinationParentPath: string,
  ) => void | Promise<void>;
  onDuplicateDrawing: (path: string) => void | Promise<void>;
  onTrashEntry: (path: string) => void | Promise<void>;
  onRevealEntry: (path: string) => void | Promise<void>;
  onSwitchVault: () => void | Promise<void>;
  treeNodes: TreeNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (folderPath: string) => void;
  onExpandFolder: (folderPath: string) => void;
  allIndexedEntries: VaultEntry[];
  isIndexing?: boolean;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
  ownerDocument?: Document | null;
}

export const VaultNavigator = ({
  vault,
  activePath,
  collapsed,
  onToggleCollapse,
  onOpenDrawing,
  onCreateDrawing,
  onCreateFolder,
  onRenameEntry,
  onMoveEntry,
  onDuplicateDrawing,
  onTrashEntry,
  onRevealEntry,
  onSwitchVault,
  treeNodes,
  expandedFolders,
  onToggleFolder,
  onExpandFolder,
  allIndexedEntries,
  isIndexing = false,
  onRefresh,
  onOpenSettings,
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

  // Collect all known folders for move destination picker
  const allFolderPaths = Array.from(
    new Set([
      "",
      ...allIndexedEntries
        .filter((e) => e.kind === "folder")
        .map((e) => e.path),
    ]),
  );

  // Search filtering
  const MAX_RENDERED_SEARCH_RESULTS = 100;
  const rawSearchResults = searchQuery.trim()
    ? searchEntries(allIndexedEntries, searchQuery)
    : [];
  const searchResults = rawSearchResults.slice(0, MAX_RENDERED_SEARCH_RESULTS);
  const hasMoreResults = rawSearchResults.length > MAX_RENDERED_SEARCH_RESULTS;

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
            setTrashTarget(item);
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
      <div className="vault-navigator__header">
        <div className="vault-navigator__title-group">
          <div className="vault-navigator__title" title={vault.name}>
            {vault.name}
          </div>
          <div className="vault-navigator__subtitle" title={vault.path}>
            {vault.path}
          </div>
        </div>
        <div className="vault-navigator__actions">
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
                title="New Drawing at root"
                aria-label="New Drawing"
              >
                <IconDrawing />
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
                title="New Folder at root"
                aria-label="New Folder"
              >
                <IconFolder />
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
            onClick={onToggleCollapse}
            title="Collapse Navigator"
            aria-label="Collapse Navigator"
          >
            <IconClose />
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="vault-search">
        <div className="vault-search__box">
          <IconSearch />
          <input
            ref={searchInputRef}
            type="text"
            className="vault-search__input"
            placeholder="Search drawings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
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

      {/* Search Results or Tree View */}
      <div
        ref={treeContainerRef}
        className="vault-tree-container"
        role="tree"
        id={treeId}
        tabIndex={0}
        onKeyDown={searchQuery.trim() ? undefined : handleTreeKeyDown}
      >
        {searchQuery.trim() ? (
          <div>
            <div
              style={{
                padding: "6px 10px",
                fontSize: "0.75rem",
                color: "var(--vault-text-muted)",
              }}
            >
              {rawSearchResults.length} result
              {rawSearchResults.length === 1 ? "" : "s"} found
              {hasMoreResults &&
                ` (showing first ${MAX_RENDERED_SEARCH_RESULTS}; please narrow search)`}
              :
            </div>
            {searchResults.length === 0 ? (
              <div className="vault-tree-empty">No matching files found.</div>
            ) : (
              searchResults.map((entry) => (
                <div
                  key={entry.path}
                  className={`vault-tree-item ${
                    entry.path === activePath ? "vault-tree-item--active" : ""
                  }`}
                  onClick={() => {
                    if (entry.kind === "drawing") {
                      void onOpenDrawing(entry.path);
                    } else {
                      onExpandFolder(entry.path);
                      setSearchQuery("");
                    }
                  }}
                  role="treeitem"
                  aria-selected={entry.path === activePath}
                >
                  <div className="vault-tree-item__main">
                    <span className="vault-tree-item__icon">
                      {entry.kind === "folder" ? (
                        <IconFolder />
                      ) : (
                        <IconDrawing />
                      )}
                    </span>
                    <span className="vault-tree-item__name" title={entry.path}>
                      {entry.name.replace(/\.excalidraw$/i, "")}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--vault-text-faint)",
                      marginLeft: "4px",
                    }}
                  >
                    {entry.kind}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div>
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
                onRename={(entry) => setRenameTarget(entry)}
                onMove={(entry) => setMoveTarget(entry)}
                onDuplicate={(entry) => void onDuplicateDrawing(entry.path)}
                onTrash={(entry) => setTrashTarget(entry)}
                onReveal={(entry) => void onRevealEntry(entry.path)}
              />
            )}
          </div>
        )}
      </div>

      {/* Switch Vault Footer Button & Settings */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--vault-border)",
          backgroundColor: "var(--vault-bg)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            onClick={() => void onSwitchVault()}
            title="Close current vault and open another"
          >
            <IconFolder />
            <span>Switch Vault</span>
          </button>
          {onOpenSettings && (
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Settings"
              style={{ width: "28px", height: "28px", padding: "0" }}
            >
              <IconSettings />
            </button>
          )}
        </div>
        <span style={{ fontSize: "0.72rem", color: "var(--vault-text-faint)" }}>
          {allIndexedEntries.filter((e) => e.kind === "drawing").length}{" "}
          drawings
        </span>
      </div>

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
  onRename: (entry: VaultEntry) => void;
  onMove: (entry: VaultEntry) => void;
  onDuplicate: (entry: VaultEntry) => void;
  onTrash: (entry: VaultEntry) => void;
  onReveal: (entry: VaultEntry) => void;
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
  onRename,
  onMove,
  onDuplicate,
  onTrash,
  onReveal,
}: TreeRendererProps) => {
  return (
    <>
      {nodes.map((node) => {
        const entry = node.entry;
        const isFolder = entry.kind === "folder";
        const isExpanded = expandedFolders.has(entry.path);
        const isActive = entry.path === activePath;
        const isFocused = entry.path === focusedPath;

        return (
          <div key={entry.path} style={{ display: "contents" }}>
            <div
              className={`vault-tree-item ${
                isActive ? "vault-tree-item--active" : ""
              } ${isFocused ? "vault-tree-item--focused" : ""}`}
              style={{ "--depth": depth } as React.CSSProperties}
              role="treeitem"
              aria-expanded={isFolder ? isExpanded : undefined}
              aria-selected={isActive}
              tabIndex={isFocused ? 0 : -1}
              onClick={() => onSelect(entry.path, entry.kind)}
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
                  <span style={{ width: "14px", display: "inline-block" }} />
                )}

                <span className="vault-tree-item__icon">
                  {isFolder ? <IconFolder /> : <IconDrawing />}
                </span>

                <span className="vault-tree-item__name" title={entry.path}>
                  {isFolder
                    ? entry.name
                    : entry.name.replace(/\.excalidraw$/i, "")}
                </span>
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

                {!isFolder && !readOnly && (
                  <button
                    type="button"
                    className="vault-tree-action-btn"
                    title="Duplicate drawing"
                    onClick={() => onDuplicate(entry)}
                    aria-label="Duplicate drawing"
                  >
                    <IconCopy />
                  </button>
                )}

                {!readOnly && (
                  <>
                    <button
                      type="button"
                      className="vault-tree-action-btn"
                      title="Rename"
                      onClick={() => onRename(entry)}
                      aria-label="Rename"
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className="vault-tree-action-btn"
                      title="Move"
                      onClick={() => onMove(entry)}
                      aria-label="Move"
                    >
                      <IconMove />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="vault-tree-action-btn"
                  title="Reveal in OS file manager"
                  onClick={() => onReveal(entry)}
                  aria-label="Reveal in file manager"
                >
                  <IconReveal />
                </button>

                {!readOnly && (
                  <button
                    type="button"
                    className="vault-tree-action-btn"
                    title="Trash"
                    onClick={() => onTrash(entry)}
                    aria-label="Trash"
                  >
                    <IconTrash />
                  </button>
                )}
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
                onRename={onRename}
                onMove={onMove}
                onDuplicate={onDuplicate}
                onTrash={onTrash}
                onReveal={onReveal}
              />
            )}
          </div>
        );
      })}
    </>
  );
};
