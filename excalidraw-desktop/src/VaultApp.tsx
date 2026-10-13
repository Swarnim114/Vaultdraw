import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorMessage } from "./vault/types";
import {
  desktopRepository,
  isTauriAvailable,
} from "./vault/DesktopVaultRepository";
import { DesktopVaultSearch } from "./search/DesktopVaultSearch";
import {
  addRecentVault,
  getExpandedFolders,
  getLastVaultPath,
  getNavigatorCollapsed,
  getPreferences,
  getRecentVaults,
  removeRecentVault,
  setExpandedFolders as saveExpandedFolders,
  setNavigatorCollapsed as saveNavigatorCollapsed,
  setTheme,
  updatePreferences,
} from "./vault/preferences";
import {
  getSettingsStatus,
  PREFERENCES_CHANGED_EVENT,
  SETTINGS_STATUS_EVENT,
  type SettingsStatus,
} from "./vault/settingsSync";
import {
  buildTree,
  duplicateName,
  getBaseName,
  getParentPath,
  joinPath,
  scanVaultMetadata,
} from "./vault/treeStore";
import { useVaultDocument } from "./vault/useVaultDocument";
import { useAppearance } from "./vault/useAppearance";
import { useInterfaceZoom } from "./vault/useInterfaceZoom";
import { useVaultSettings } from "./vault/useVaultSettings";
import {
  ensureFolder,
  folderChain,
  resolveNewDrawingParent,
} from "./vault/newDrawing";
import { LibraryStore } from "./library/libraryStore";
import { desktopLibraryRepository } from "./library/DesktopLibraryRepository";
import VaultEditor from "./editor/VaultEditor";
import { VaultHeader } from "./components/VaultHeader";
import { VaultNavigator } from "./components/VaultNavigator";
import { Onboarding } from "./components/Onboarding";
import { ConflictDialog } from "./components/ConflictDialog";
import { RecoveryDialog } from "./components/RecoveryDialog";
import { SettingsModal } from "./components/settings/SettingsModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { IconClose, IconDrawing, IconPlus } from "./components/Icons";

import "./components/VaultShell.css";

import type { VaultSearch } from "./search/types";

import type { LibraryRepository } from "./library/types";
import type {
  VaultChange,
  VaultEntry,
  VaultInfo,
  VaultRepository,
} from "./vault/types";

export interface VaultAppProps {
  ownerDocument?: Document | null;
  ownerWindow?: Window | null;
  repository?: VaultRepository;
  /** Vault-wide search; defaults to the native index under Tauri, else name-only. */
  search?: VaultSearch | null;
  initialVault?: VaultInfo | null;
  libraryRepository?: LibraryRepository;
}

export const VaultApp = ({
  ownerDocument: propDoc,
  ownerWindow: propWin,
  repository = desktopRepository,
  search,
  initialVault = null,
  libraryRepository = desktopLibraryRepository,
}: VaultAppProps) => {
  const libraryBundle = useMemo(
    () => ({
      store: new LibraryStore(libraryRepository),
      repository: libraryRepository,
    }),
    [libraryRepository],
  );
  const libraryStore = libraryBundle.store;
  const [mountedDocument, setMountedDocument] = useState<Document | null>(null);

  // Derive browser APIs from the mounted node, never from ambient globals.
  const doc = propDoc ?? mountedDocument;
  const win = propWin ?? doc?.defaultView ?? null;
  const defaultSearch = useMemo(
    () => (isTauriAvailable(win) ? new DesktopVaultSearch() : null),
    [win],
  );
  const vaultSearch = search === undefined ? defaultSearch : search;
  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setMountedDocument(node.ownerDocument);
    }
  }, []);

  const [vault, setVault] = useState<VaultInfo | null>(initialVault);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [globalAlert, setGlobalAlert] = useState<{
    message: string;
    type: "error" | "info";
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showCloseDiscardConfirm, setShowCloseDiscardConfirm] = useState(false);

  // Directory entries cache: folderPath -> VaultEntry[]
  const [directoryMap, setDirectoryMap] = useState<Map<string, VaultEntry[]>>(
    () => new Map(),
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set([""]),
  );

  // Background search metadata
  const [allIndexedEntries, setAllIndexedEntries] = useState<VaultEntry[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [recoveryCount, setRecoveryCount] = useState(0);

  // UI state
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(() =>
    getNavigatorCollapsed(win),
  );
  const [searchFocusNonce, setSearchFocusNonce] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{
    path: string;
    elementId: string;
    containerId: string | null;
    nonce: number;
  } | null>(null);
  const focusNonceRef = useRef(0);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // Colour theme + mode: tokens, html.dark, canvas sync (see useAppearance).
  const appearance = useAppearance(doc, win);
  const { refresh: refreshAppearance } = appearance;
  const appTheme = appearance.snapshot.mode;
  useInterfaceZoom(doc, win);
  // Per-vault settings.toml overrides merged over config.toml (vault > global).
  const vaultSettings = useVaultSettings(win, vault);
  const { navigatorSort, newDrawingFolder } = vaultSettings.effective;
  const confirmDelete = getPreferences(win).confirmDelete;

  const handleCanvasThemeChange = useCallback(
    (newTheme: "light" | "dark" | "system") => {
      setTheme(newTheme, win);
      refreshAppearance();
    },
    [win, refreshAppearance],
  );

  // Live config folder sync: config.toml edits (by hand or another window)
  // reload preferences; re-render so autosave delay and defaults follow
  // (useAppearance re-applies the theme itself).
  const [, setPreferencesVersion] = useState(0);
  // Settings and theme problems get their own persistent banner: unrelated
  // setGlobalAlert(null) calls must not hide a still-broken config.
  const [settingsProblems, setSettingsProblems] = useState<string[]>(() =>
    getSettingsStatus().problems.map((p) => p.message),
  );
  const [dismissedProblem, setDismissedProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!win) {
      return;
    }
    const showSettingsStatus = (settingsStatus: SettingsStatus) => {
      const next = settingsStatus.problems.map((p) => p.message);
      setSettingsProblems((prev) =>
        prev.length === next.length && prev.every((m, i) => m === next[i])
          ? prev
          : next,
      );
    };
    const handlePreferencesChanged = () => {
      setNavigatorCollapsed(getNavigatorCollapsed(win));
      setPreferencesVersion((v) => v + 1);
    };
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<SettingsStatus>).detail;
      showSettingsStatus(detail ?? getSettingsStatus());
    };
    showSettingsStatus(getSettingsStatus());
    win.addEventListener(PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
    win.addEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    return () => {
      win.removeEventListener(
        PREFERENCES_CHANGED_EVENT,
        handlePreferencesChanged,
      );
      win.removeEventListener(SETTINGS_STATUS_EVENT, handleStatus);
    };
  }, [win]);

  const allProblems = [
    ...settingsProblems,
    ...vaultSettings.problems.map((p) => p.message),
    ...(appearance.snapshot.problem ? [appearance.snapshot.problem] : []),
    ...(appearance.registry.loadError ? [appearance.registry.loadError] : []),
  ];
  const problemText = allProblems.length
    ? allProblems.length > 1
      ? `${allProblems[0]} (and ${allProblems.length - 1} more)`
      : allProblems[0]
    : null;
  const visibleProblem =
    problemText && problemText !== dismissedProblem ? problemText : null;
  // Once fixed, the same problem coming back is shown again.
  useEffect(() => {
    if (!problemText) {
      setDismissedProblem(null);
    }
  }, [problemText]);

  // Refs for tracking active lifecycle, generations, and loaded folders
  useEffect(() => {
    void libraryStore.setVault(vault?.handle ?? null, vault?.readOnly ?? false);
  }, [libraryStore, vault?.handle, vault?.readOnly]);

  const vaultRef = useRef<VaultInfo | null>(vault);
  vaultRef.current = vault;
  const vaultGeneration = useRef(0);
  const directoryMapRef = useRef(directoryMap);
  directoryMapRef.current = directoryMap;
  const indexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appWinRef = useRef<any>(null);
  const closePromiseRef = useRef<Promise<void> | null>(null);
  const closeAttemptRef = useRef(false);
  const reopenEffectGeneration = useRef(0);

  useEffect(() => {
    if (win) {
      setNavigatorCollapsed(getNavigatorCollapsed(win));
    }
  }, [win]);

  // Editor document hook
  const docHook = useVaultDocument(repository, vault, {
    autosaveDelayMs: getPreferences(win).autosaveDelayMs,
  });
  const {
    document: activeDoc,
    status: saveStatus,
    error: saveError,
    open: openDoc,
    create: createDoc,
    change: changeDoc,
    flush: flushDoc,
    close: closeDoc,
    reload: reloadDoc,
    saveCopy: saveCopyDoc,
    relocate: relocateDoc,
  } = docHook;

  const docHookRef = useRef(docHook);
  docHookRef.current = docHook;

  // One close path serves both window close and app-wide Quit. Keep the editor
  // frozen after a failed flush until the user explicitly keeps editing/discards.
  const flushAndDestroy = useCallback(() => {
    if (closePromiseRef.current) {
      return closePromiseRef.current;
    }
    if (closeAttemptRef.current) {
      return Promise.resolve();
    }
    closeAttemptRef.current = true;
    setIsClosing(true);
    const operation = (async () => {
      try {
        await docHookRef.current.flush();
        await libraryStore.flush();
        await appWinRef.current?.destroy();
        setShowCloseDiscardConfirm(false);
      } catch {
        setShowCloseDiscardConfirm(true);
      } finally {
        closePromiseRef.current = null;
      }
    })();
    closePromiseRef.current = operation;
    return operation;
  }, [libraryStore]);

  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    let unlistenQuit: (() => void) | undefined;
    let disposed = false;

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { listen } = await import("@tauri-apps/api/event");
        const appWin = getCurrentWindow();
        appWinRef.current = appWin;
        unlistenClose = await appWin.onCloseRequested((event) => {
          event.preventDefault();
          void flushAndDestroy();
        });
        unlistenQuit = await listen("vault-quit-request", () => {
          void flushAndDestroy();
        });
        if (disposed) {
          unlistenClose();
          unlistenQuit();
        }
      } catch {
        // Not running inside Tauri window.
      }
    })();

    return () => {
      disposed = true;
      unlistenClose?.();
      unlistenQuit?.();
    };
  }, [flushAndDestroy]);

  // Explicit Save action wired to flushDoc (Ctrl+S / Cmd+S and UI Save button)
  const handleExplicitSave = useCallback(async () => {
    if (!activeDoc || vault?.readOnly || isBusy || isClosing) {
      return;
    }
    try {
      // Saving must not end an in-progress text edit (Excalidraw keeps typing).
      await flushDoc({ commitText: false });
    } catch (err) {
      setGlobalAlert({
        message: `Save failed: ${errorMessage(err)}`,
        type: "error",
      });
    }
  }, [activeDoc, flushDoc, isBusy, isClosing, vault?.readOnly]);

  // Global Ctrl+S / Cmd+S listener with committed text editing preservation
  useEffect(() => {
    if (!doc) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleExplicitSave();
      }
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [doc, handleExplicitSave]);

  // Cmd+, (Ctrl+, elsewhere) opens Settings. Hard-wired until the command
  // registry lands. Like Cmd+S it never ends a text edit: Settings opens
  // without taking focus from an active text field (see SettingsModal).
  const hasVault = vault !== null;
  useEffect(() => {
    if (!doc || !hasVault) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !(e.metaKey || e.ctrlKey) ||
        e.altKey ||
        e.shiftKey ||
        (e.key !== "," && e.code !== "Comma")
      ) {
        return;
      }
      e.preventDefault();
      // Another dialog (rename, move, confirm...) or Settings itself is open.
      if (doc.querySelector(".vault-modal-backdrop")) {
        return;
      }
      setShowSettingsModal(true);
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [doc, hasVault]);

  // Cmd+Shift+F (Ctrl+Shift+F elsewhere) focuses the navigator search.
  // Hard-wired until the command registry lands, like Cmd+,. Excalidraw does
  // not bind it (its find is Cmd+F with a lowercase key), the capture phase
  // just guarantees nothing else sees it.
  useEffect(() => {
    if (!doc || !hasVault) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !(e.metaKey || e.ctrlKey) ||
        !e.shiftKey ||
        e.altKey ||
        e.code !== "KeyF"
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (doc.querySelector(".vault-modal-backdrop")) {
        return;
      }
      setNavigatorCollapsed((collapsed) => {
        if (collapsed) {
          saveNavigatorCollapsed(false, win);
        }
        return false;
      });
      setSearchFocusNonce((n) => n + 1);
    };
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, [doc, hasVault, win]);

  // Load a directory's entries with generation check and error surfacing
  const loadDirectory = useCallback(
    async (dirPath: string, expectedGen?: number) => {
      if (!vault) {
        return;
      }
      const gen = expectedGen ?? vaultGeneration.current;
      try {
        const items = await repository.listDirectory(vault.handle, dirPath);
        if (gen !== vaultGeneration.current) {
          return;
        }
        setDirectoryMap((prev) => {
          const next = new Map(prev);
          next.set(dirPath, items);
          return next;
        });
      } catch (err) {
        if (gen === vaultGeneration.current) {
          setGlobalAlert({
            message: `Could not load folder "${
              dirPath || "root"
            }": ${errorMessage(err)}`,
            type: "error",
          });
        }
      }
    },
    [repository, vault],
  );

  // Background indexing with cancellation and generation guard
  const startIndexing = useCallback(
    (signal?: AbortSignal, expectedGen?: number) => {
      if (!vault) {
        return;
      }
      const gen = expectedGen ?? vaultGeneration.current;
      setIsIndexing(true);
      scanVaultMetadata(repository, vault.handle, signal, (progress) => {
        if (gen === vaultGeneration.current && !signal?.aborted) {
          setAllIndexedEntries([...progress]);
        }
      })
        .then((finalList) => {
          if (gen === vaultGeneration.current && !signal?.aborted) {
            setAllIndexedEntries(finalList);
          }
          setIsIndexing(false);
        })
        .catch(() => {
          setIsIndexing(false);
        });
    },
    [repository, vault],
  );

  // Refresh recovery count with generation guard
  const refreshRecovery = useCallback(
    async (expectedGen?: number) => {
      if (!vault) {
        return;
      }
      const gen = expectedGen ?? vaultGeneration.current;
      try {
        const items = await repository.listRecovery(vault.handle);
        if (gen === vaultGeneration.current) {
          setRecoveryCount(items.length);
        }
      } catch {
        if (gen === vaultGeneration.current) {
          setRecoveryCount(0);
        }
      }
    },
    [repository, vault],
  );

  // Initial vault setup & reopen: coalesced/idempotent, never leaves cancelled handle open
  useEffect(() => {
    if (initialVault) {
      return;
    }
    let cancelled = false;
    const effectGeneration = ++reopenEffectGeneration.current;

    repository
      .reopenVault()
      .then((reopened) => {
        if (cancelled) {
          // StrictMode immediately re-runs effects on this same instance. Defer
          // release so the replacement effect can claim the coalesced handle.
          queueMicrotask(() => {
            if (
              reopened &&
              reopenEffectGeneration.current === effectGeneration
            ) {
              void repository.releaseVault(reopened.handle).catch(() => {});
            }
          });
          return;
        }
        // Do not overwrite if a vault was already chosen in the meantime
        if (vaultRef.current) {
          if (reopened) {
            void repository.releaseVault(reopened.handle).catch(() => {});
          }
          return;
        }
        if (reopened) {
          setVault(reopened);
          addRecentVault(reopened.path, win);
        }
      })
      .catch(() => {
        // Reopen error handled gracefully
      });

    return () => {
      cancelled = true;
    };
  }, [initialVault, repository, win]);

  // When active vault changes: initialize directories, indexing, watching
  useEffect(() => {
    if (!vault) {
      setDirectoryMap(new Map());
      setAllIndexedEntries([]);
      setRecoveryCount(0);
      return;
    }

    const currentGen = vaultGeneration.current;
    const abortController = new AbortController();

    // Restore expanded folders from preferences keyed by STABLE vault.path
    const savedExpanded = getExpandedFolders(vault.path, win);
    const initialSet = new Set(["", ...savedExpanded]);
    setExpandedFolders(initialSet);

    // Load root directory and expanded folders
    void loadDirectory("", currentGen);
    for (const folder of savedExpanded) {
      if (folder) {
        void loadDirectory(folder, currentGen);
      }
    }

    // Start background scan and check recovery
    startIndexing(abortController.signal, currentGen);
    void refreshRecovery(currentGen);

    // Watcher subscription: handle late .then(off) cleanup
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    const scheduleCoalescedIndex = () => {
      if (indexTimeoutRef.current) {
        clearTimeout(indexTimeoutRef.current);
      }
      indexTimeoutRef.current = setTimeout(() => {
        if (!disposed && currentGen === vaultGeneration.current) {
          startIndexing(abortController.signal, currentGen);
        }
      }, 500);
    };

    repository
      .subscribe((event: VaultChange) => {
        if (
          disposed ||
          event.handle !== vault.handle ||
          currentGen !== vaultGeneration.current
        ) {
          return;
        }

        if (event.rescan) {
          void loadDirectory("", currentGen);
          scheduleCoalescedIndex();
          void refreshRecovery(currentGen);
          return;
        }

        // Re-read affected loaded directories directly WITHOUT setState updater side-effects
        const loadedDirs = Array.from(directoryMapRef.current.keys());
        for (const dir of loadedDirs) {
          const prefix = dir === "" ? "" : `${dir}/`;
          const touches = event.paths.some(
            (p) =>
              p === dir ||
              (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")),
          );
          if (touches) {
            void loadDirectory(dir, currentGen);
          }
        }

        // Keep search metadata current from affected parent listings; autosaves
        // do not trigger a full recursive scan, while external creates appear.
        void (async () => {
          const parents = new Set(event.paths.map(getParentPath));
          for (const parent of parents) {
            const entries = await repository.listDirectory(
              vault.handle,
              parent,
            );
            if (disposed || currentGen !== vaultGeneration.current) {
              return;
            }
            const entryPaths = new Set(entries.map((entry) => entry.path));
            setAllIndexedEntries((previous) => {
              const removedFolders = previous
                .filter(
                  (entry) =>
                    getParentPath(entry.path) === parent &&
                    entry.kind === "folder" &&
                    !entryPaths.has(entry.path),
                )
                .map((entry) => entry.path);
              return [
                ...previous.filter((entry) => {
                  if (getParentPath(entry.path) === parent) {
                    return false;
                  }
                  return !removedFolders.some((folder) =>
                    entry.path.startsWith(`${folder}/`),
                  );
                }),
                ...entries,
              ];
            });
          }
        })().catch((err) => {
          if (!disposed && currentGen === vaultGeneration.current) {
            setGlobalAlert({
              message: `Could not update search index: ${errorMessage(err)}`,
              type: "error",
            });
          }
        });

        // Refresh recovery count on changes
        void refreshRecovery(currentGen);
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unsubscribe = off;
        }
      })
      .catch((err) => {
        if (!disposed) {
          setGlobalAlert({
            message: `Watcher error: ${errorMessage(err)}`,
            type: "error",
          });
        }
      });

    return () => {
      disposed = true;
      if (indexTimeoutRef.current) {
        clearTimeout(indexTimeoutRef.current);
        indexTimeoutRef.current = null;
      }
      abortController.abort();
      unsubscribe?.();
    };
  }, [loadDirectory, refreshRecovery, repository, startIndexing, vault, win]);

  // Safely switch vaults: flush and close old doc BEFORE releasing old vault handle
  const safelySwitchVault = async (chosen: VaultInfo) => {
    if (vault && chosen.path === vault.path) {
      // Avoid choosing same old root and acquiring a duplicate/read-only clone
      await repository.releaseVault(chosen.handle);
      return;
    }
    const oldVault = vault;
    try {
      // Close old doc first (flushes pending edits). Keep its generation valid
      // until that succeeds so a failed flush leaves the current vault usable.
      await closeDoc();
      vaultGeneration.current += 1;
      // Release old vault handle ONLY after old doc has flushed and closed
      if (oldVault) {
        await libraryStore.flush();
        await repository.releaseVault(oldVault.handle);
      }
      // Immediately reset directory cache and indexes
      setDirectoryMap(new Map());
      setAllIndexedEntries([]);
      setRecoveryCount(0);
      setVault(chosen);
      addRecentVault(chosen.path, win);
    } catch (err) {
      // The caller owns cleanup of the newly selected handle on failure.
      throw err;
    }
  };

  // Open Vault action
  const handleOpenVault = async () => {
    setGlobalAlert(null);
    setOnboardingError(null);
    setLoadingVault(true);
    let chosen: VaultInfo | null = null;
    try {
      chosen = await repository.chooseVault(false);
      if (chosen) {
        await safelySwitchVault(chosen);
      }
    } catch (err: unknown) {
      if (chosen) {
        try {
          await repository.releaseVault(chosen.handle);
        } catch {}
      }
      const msg = errorMessage(err);
      setOnboardingError(msg);
      setGlobalAlert({ message: msg, type: "error" });
    } finally {
      setLoadingVault(false);
    }
  };

  // Create Vault action
  const handleCreateVault = async () => {
    setGlobalAlert(null);
    setOnboardingError(null);
    setLoadingVault(true);
    let chosen: VaultInfo | null = null;
    try {
      chosen = await repository.chooseVault(true);
      if (chosen) {
        await safelySwitchVault(chosen);
      }
    } catch (err: unknown) {
      if (chosen) {
        try {
          await repository.releaseVault(chosen.handle);
        } catch {}
      }
      const msg = errorMessage(err);
      setOnboardingError(msg);
      setGlobalAlert({ message: msg, type: "error" });
    } finally {
      setLoadingVault(false);
    }
  };

  // Switch vault action (await flush before switching; no unsupported discard branch)
  const handleSwitchVault = async () => {
    setGlobalAlert(null);
    let chosen: VaultInfo | null = null;
    setIsBusy(true);
    try {
      chosen = await repository.chooseVault(false);
      if (chosen) {
        await safelySwitchVault(chosen);
      }
    } catch (err: unknown) {
      if (chosen) {
        try {
          await repository.releaseVault(chosen.handle);
        } catch {}
      }
      const msg = errorMessage(err);
      setGlobalAlert({ message: `Cannot switch vault: ${msg}`, type: "error" });
    } finally {
      setIsBusy(false);
    }
  };

  // Toggle navigator collapse
  const handleToggleNavigator = () => {
    setNavigatorCollapsed((prev) => {
      const next = !prev;
      saveNavigatorCollapsed(next, win);
      return next;
    });
  };

  // Toggle folder expansion in tree using STABLE vault.path
  const handleToggleFolder = (folderPath: string) => {
    if (!vault) {
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
        void loadDirectory(folderPath);
      }
      saveExpandedFolders(vault.path, Array.from(next), win);
      return next;
    });
  };

  const handleExpandFolder = (folderPath: string) => {
    if (!vault) {
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(folderPath);
      void loadDirectory(folderPath);
      saveExpandedFolders(vault.path, Array.from(next), win);
      return next;
    });
  };

  // Open drawing with busy freeze and error catching
  const handleOpenDrawing = async (drawingPath: string) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await openDoc(drawingPath);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to open drawing: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Search result: open the drawing (unless active), then focus the element.
  const handleOpenSearchResult = async (
    drawingPath: string,
    match?: { elementId: string; containerId: string | null },
  ) => {
    if (drawingPath !== activeDoc?.path) {
      await handleOpenDrawing(drawingPath);
    }
    if (match) {
      setFocusRequest({
        path: drawingPath,
        elementId: match.elementId,
        containerId: match.containerId,
        nonce: ++focusNonceRef.current,
      });
    }
  };

  // Create drawing
  const handleCreateDrawing = async (parentPath: string, name: string) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const prefs = getPreferences(win);
      const initialAppState = {
        theme: appTheme,
        viewBackgroundColor:
          prefs.defaultCanvasBackground ||
          (appTheme === "dark" ? "#121212" : "#ffffff"),
        currentItemFontFamily: prefs.defaultFontFamily,
        currentItemFontSize: prefs.defaultFontSize,
        currentItemStrokeColor: prefs.defaultStrokeColor,
        currentItemBackgroundColor: prefs.defaultBackgroundColor,
        currentItemFillStyle: prefs.defaultFillStyle,
        currentItemStrokeWidth: prefs.defaultStrokeWidth,
        currentItemRoughness: prefs.defaultRoughness,
      };
      await createDoc(parentPath, name, initialAppState);
      await loadDirectory(parentPath);
      handleExpandFolder(parentPath);
      startIndexing();
    } catch (err) {
      setGlobalAlert({
        message: `Failed to create drawing: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // New drawing from the header / empty state: honours the default folder
  // setting (created when missing); otherwise next to the open drawing.
  const handleNewDrawing = async () => {
    if (!vault) {
      return;
    }
    const parent = resolveNewDrawingParent(
      newDrawingFolder,
      activeDoc?.path ?? null,
    );
    const name = `Drawing-${Date.now().toString().slice(-4)}.excalidraw`;
    if (newDrawingFolder && !vault.readOnly) {
      try {
        const created = await ensureFolder(repository, vault.handle, parent);
        if (created.length > 0) {
          const chain = ["", ...folderChain(parent)];
          for (const folder of chain.slice(0, -1)) {
            await loadDirectory(folder);
            if (folder) {
              handleExpandFolder(folder);
            }
          }
        }
      } catch (err) {
        setGlobalAlert({
          message: `Could not create the default folder "${parent}": ${errorMessage(
            err,
          )}`,
          type: "error",
        });
        return;
      }
    }
    await handleCreateDrawing(parent, name);
  };

  // Create folder
  const handleCreateFolder = async (parentPath: string, name: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const path = joinPath(parentPath, name);
      await repository.createFolder(vault.handle, path);
      await loadDirectory(parentPath);
      handleExpandFolder(parentPath);
      handleExpandFolder(path);
      startIndexing();
    } catch (err) {
      setGlobalAlert({
        message: `Failed to create folder: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Rename entry
  const handleRenameEntry = async (oldPath: string, newName: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const parent = getParentPath(oldPath);
      const newPath = joinPath(parent, newName);

      if (
        activeDoc &&
        (activeDoc.path === oldPath || activeDoc.path.startsWith(`${oldPath}/`))
      ) {
        await relocateDoc(oldPath, newPath);
      } else {
        await repository.move(vault.handle, oldPath, newPath);
      }
      await loadDirectory(parent);
      startIndexing();
    } catch (err) {
      setGlobalAlert({
        message: `Failed to rename: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Move entry
  const handleMoveEntry = async (
    sourcePath: string,
    destinationParentPath: string,
  ) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const base = getBaseName(sourcePath);
      const newPath = joinPath(destinationParentPath, base);
      const oldParent = getParentPath(sourcePath);

      if (
        activeDoc &&
        (activeDoc.path === sourcePath ||
          activeDoc.path.startsWith(`${sourcePath}/`))
      ) {
        await relocateDoc(sourcePath, newPath);
      } else {
        await repository.move(vault.handle, sourcePath, newPath);
      }
      await loadDirectory(oldParent);
      await loadDirectory(destinationParentPath);
      handleExpandFolder(destinationParentPath);
      startIndexing();
    } catch (err) {
      setGlobalAlert({
        message: `Failed to move: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Duplicate drawing: FLUSH ACTIVE DRAWING BEFORE READ to copy latest edits
  const handleDuplicateDrawing = async (path: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      if (activeDoc && activeDoc.path === path) {
        await flushDoc({ commitText: false });
      }
      const file = await repository.readDrawing(vault.handle, path);
      let target = duplicateName(path);
      const knownPaths = new Set(allIndexedEntries.map((e) => e.path));
      while (knownPaths.has(target)) {
        target = duplicateName(target);
      }
      const opId = `dup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await repository.writeDrawing({
        handle: vault.handle,
        path: target,
        json: file.json,
        expectedRevision: null,
        operationId: opId,
      });
      const parent = getParentPath(target);
      await loadDirectory(parent);
      startIndexing();
      await openDoc(target);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to duplicate drawing: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Trash entry
  const handleTrashEntry = async (path: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      if (
        activeDoc &&
        (activeDoc.path === path || activeDoc.path.startsWith(`${path}/`))
      ) {
        await closeDoc();
      }
      await repository.trash(vault.handle, path);
      const parent = getParentPath(path);
      await loadDirectory(parent);
      startIndexing();
    } catch (err) {
      setGlobalAlert({
        message: `Failed to trash entry: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Reveal entry in OS file manager
  const handleRevealEntry = async (path: string) => {
    if (!vault) {
      return;
    }
    try {
      await repository.reveal(vault.handle, path);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to reveal entry: ${errorMessage(err)}`,
        type: "error",
      });
    }
  };

  // Open recovered snapshot as copy
  const handleOpenRecovered = async (targetPath: string, json: string) => {
    if (!vault) {
      return;
    }
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      const opId = `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await repository.writeDrawing({
        handle: vault.handle,
        path: targetPath,
        json,
        expectedRevision: null,
        operationId: opId,
      });
      const parent = getParentPath(targetPath);
      await loadDirectory(parent);
      startIndexing();
      await openDoc(targetPath);
    } catch (err) {
      setGlobalAlert({
        message: `Failed to open recovered snapshot: ${errorMessage(err)}`,
        type: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleReloadConflict = async () => {
    setIsBusy(true);
    try {
      await reloadDoc();
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveConflictCopy = async (path: string) => {
    setIsBusy(true);
    try {
      await saveCopyDoc(path);
    } finally {
      setIsBusy(false);
    }
  };

  // Build tree nodes for Navigator
  const treeNodes = useMemo(() => {
    return buildTree(directoryMap, "", navigatorSort);
  }, [directoryMap, navigatorSort]);

  const recentVaults = getRecentVaults(win);
  const lastVaultPath = getLastVaultPath(win);

  // If no vault open, render onboarding
  if (!vault) {
    return (
      <div
        ref={setRootNode}
        className={`vault-app ${isClosing ? "vault-app--closing" : ""}`}
      >
        {visibleProblem && (
          <div
            className="vault-global-alert vault-settings-alert"
            role="alert"
            data-testid="settings-problem-banner"
          >
            <span>{visibleProblem}</span>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={() => setDismissedProblem(problemText)}
              aria-label="Dismiss settings problem"
            >
              <IconClose />
            </button>
          </div>
        )}
        <Onboarding
          recentVaults={recentVaults}
          lastVaultPath={lastVaultPath}
          onOpenVault={handleOpenVault}
          onCreateVault={handleCreateVault}
          onSelectRecent={async (recentPath) => {
            setOnboardingError(null);
            setGlobalAlert(null);
            setLoadingVault(true);
            let chosen: VaultInfo | null = null;
            try {
              if (recentPath === lastVaultPath) {
                const reopened = await repository.reopenVault();
                if (reopened) {
                  if (reopened.path === recentPath) {
                    chosen = reopened;
                    await safelySwitchVault(reopened);
                    chosen = null;
                    return;
                  }
                  // Reopened a different vault path than requested; release it immediately
                  await repository.releaseVault(reopened.handle);
                }
              }
              // Native desktop only persists the last opened vault for direct reopen.
              // Route to folder picker with explanatory hint:
              setGlobalAlert({
                message: `Native desktop reopens the last vault automatically. Please select "${recentPath}" in the folder picker.`,
                type: "info",
              });
              chosen = await repository.chooseVault(false);
              if (chosen) {
                await safelySwitchVault(chosen);
              }
            } catch (err: unknown) {
              if (chosen) {
                try {
                  await repository.releaseVault(chosen.handle);
                } catch {}
              }
              const msg = errorMessage(err);
              setOnboardingError(msg);
              setGlobalAlert({ message: msg, type: "error" });
            } finally {
              setLoadingVault(false);
            }
          }}
          onRemoveRecent={(p) => removeRecentVault(p, win)}
          error={onboardingError}
          loading={loadingVault}
          ownerWindow={win}
        />
      </div>
    );
  }

  const recentDrawings = allIndexedEntries
    .filter((entry) => entry.kind === "drawing")
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, 6);

  const EditorComponent = VaultEditor as React.ComponentType<
    React.ComponentProps<typeof VaultEditor> & {
      readOnly?: boolean;
      disabled?: boolean;
      theme?: "light" | "dark";
      onThemeChange?: (theme: "light" | "dark" | "system") => void;
    }
  >;

  return (
    <div
      ref={setRootNode}
      className={`vault-app ${isClosing ? "vault-app--closing" : ""}`}
    >
      {visibleProblem && (
        <div
          className="vault-global-alert vault-settings-alert"
          role="alert"
          data-testid="settings-problem-banner"
        >
          <span>{visibleProblem}</span>
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={() => setDismissedProblem(problemText)}
            aria-label="Dismiss settings problem"
          >
            <IconClose />
          </button>
        </div>
      )}
      {globalAlert && (
        <div
          className="vault-global-alert"
          role="alert"
          style={{
            backgroundColor:
              globalAlert.type === "info"
                ? "var(--vault-primary-light)"
                : "var(--vault-danger-bg)",
            color:
              globalAlert.type === "info"
                ? "var(--vault-primary)"
                : "var(--vault-danger)",
            borderColor:
              globalAlert.type === "info"
                ? "var(--vault-primary-border)"
                : "var(--vault-danger-border)",
          }}
        >
          <span>{globalAlert.message}</span>
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--icon"
            onClick={() => setGlobalAlert(null)}
            aria-label="Dismiss alert"
          >
            <IconClose />
          </button>
        </div>
      )}

      <VaultHeader
        vault={vault}
        activePath={activeDoc?.path ?? null}
        saveStatus={saveStatus}
        saveError={saveError}
        recoveryCount={recoveryCount}
        navigatorCollapsed={navigatorCollapsed}
        onToggleNavigator={handleToggleNavigator}
        onNewDrawing={() => void handleNewDrawing()}
        onOpenConflict={() => setShowConflictDialog(true)}
        onOpenRecovery={() => setShowRecoveryDialog(true)}
        onSave={handleExplicitSave}
      />

      <div className="vault-main">
        <div className="vault-editor-pane">
          {activeDoc ? (
            <div
              className={`vault-editor-container ${
                vault.readOnly ? "vault-editor-container--readonly" : ""
              } ${
                isBusy || isClosing || docHook.loading
                  ? "vault-editor-container--busy"
                  : ""
              }`}
            >
              <EditorComponent
                key={activeDoc.id}
                documentId={activeDoc.id}
                initialJson={activeDoc.json}
                name={getBaseName(activeDoc.path)}
                onChange={changeDoc}
                onExport={(name, bytes) => repository.exportFile(name, bytes)}
                readOnly={
                  vault.readOnly || isBusy || isClosing || docHook.loading
                }
                disabled={isBusy || isClosing || docHook.loading}
                theme={appTheme}
                onThemeChange={handleCanvasThemeChange}
                onOpenSettings={() => setShowSettingsModal(true)}
                focusRequest={
                  focusRequest?.path === activeDoc.path ? focusRequest : null
                }
                library={libraryBundle}
              />
            </div>
          ) : (
            <div className="vault-empty-state">
              <div className="vault-empty-state__icon">
                <IconDrawing width="48" height="48" />
              </div>
              <h2 className="vault-empty-state__title">No Drawing Open</h2>
              <p className="vault-empty-state__desc">
                Select a drawing from the navigator on the right, or create a
                new one to start sketching.
              </p>
              {!vault.readOnly && (
                <button
                  type="button"
                  className="vault-btn vault-btn--primary"
                  onClick={() => void handleNewDrawing()}
                >
                  <IconPlus />
                  <span>Create Drawing</span>
                </button>
              )}
              {recentDrawings.length > 0 && (
                <section className="vault-recent" aria-label="Recent drawings">
                  <h3 className="vault-recent__title">Recent</h3>
                  {recentDrawings.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className="vault-recent__item"
                      onClick={() => void handleOpenDrawing(entry.path)}
                      title={entry.path}
                    >
                      <IconDrawing />
                      <span className="vault-recent__name">
                        {getBaseName(entry.path).replace(/\.excalidraw$/i, "")}
                      </span>
                      <span className="vault-recent__folder">
                        {getParentPath(entry.path) || vault.name}
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>

        <VaultNavigator
          vault={vault}
          activePath={activeDoc?.path ?? null}
          collapsed={navigatorCollapsed}
          onToggleCollapse={handleToggleNavigator}
          onOpenSettings={() => setShowSettingsModal(true)}
          onOpenDrawing={handleOpenDrawing}
          search={vaultSearch}
          onOpenSearchResult={handleOpenSearchResult}
          searchFocusNonce={searchFocusNonce}
          onCreateDrawing={handleCreateDrawing}
          onCreateFolder={handleCreateFolder}
          onRenameEntry={handleRenameEntry}
          onMoveEntry={handleMoveEntry}
          onDuplicateDrawing={handleDuplicateDrawing}
          onTrashEntry={handleTrashEntry}
          onRevealEntry={handleRevealEntry}
          onSwitchVault={handleSwitchVault}
          sortOrder={navigatorSort}
          onSortChange={(order) => {
            // Write where the value currently lives: this vault if it
            // overrides the global order, else config.toml.
            if (vaultSettings.isOverridden("navigatorSort")) {
              void vaultSettings.setOverride("navigatorSort", order);
            } else {
              updatePreferences({ navigatorSort: order }, win);
            }
          }}
          confirmDelete={confirmDelete}
          treeNodes={treeNodes}
          expandedFolders={expandedFolders}
          onToggleFolder={handleToggleFolder}
          onExpandFolder={handleExpandFolder}
          allIndexedEntries={allIndexedEntries}
          isIndexing={isIndexing}
          onRefresh={() => {
            void loadDirectory("");
            for (const f of expandedFolders) {
              if (f) {
                void loadDirectory(f);
              }
            }
            startIndexing();
            void refreshRecovery();
          }}
          ownerDocument={doc}
        />
      </div>

      {showConflictDialog && activeDoc && (
        <ConflictDialog
          currentPath={activeDoc.path}
          errorMessage={saveError}
          onReload={handleReloadConflict}
          onSaveCopy={handleSaveConflictCopy}
          onClose={() => setShowConflictDialog(false)}
          ownerDocument={doc}
        />
      )}

      {showRecoveryDialog && (
        <RecoveryDialog
          handle={vault.handle}
          repository={repository}
          onOpenRecovered={handleOpenRecovered}
          onClose={() => setShowRecoveryDialog(false)}
          ownerDocument={doc}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          vault={vault}
          onClose={() => setShowSettingsModal(false)}
          onAppearanceChanged={refreshAppearance}
          themeRegistry={appearance.registry}
          onRevealVault={(path) => {
            void handleRevealEntry(path);
          }}
          ownerDocument={doc}
        />
      )}

      {showCloseDiscardConfirm && (
        <ConfirmModal
          title="Unsaved Changes"
          message="You have unsaved changes that could not be saved to disk. Discard unsaved changes and close window?"
          confirmLabel="Discard and Close"
          cancelLabel="Keep Window Open"
          isDanger
          onConfirm={async () => {
            closeAttemptRef.current = true;
            setShowCloseDiscardConfirm(false);
            try {
              if (appWinRef.current) {
                await appWinRef.current.destroy();
              }
            } catch (err) {
              setGlobalAlert({
                message: `Could not close window: ${errorMessage(err)}`,
                type: "error",
              });
              setShowCloseDiscardConfirm(true);
            }
          }}
          onCancel={() => {
            setShowCloseDiscardConfirm(false);
            closeAttemptRef.current = false;
            setIsClosing(false);
          }}
          ownerDocument={doc}
        />
      )}
    </div>
  );
};

export default VaultApp;
