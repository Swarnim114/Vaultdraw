import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { errorMessage, isNotFoundError } from "./vault/types";
import {
  desktopRepository,
  isTauriAvailable,
} from "./vault/DesktopVaultRepository";
import { DesktopVaultSearch } from "./search/DesktopVaultSearch";
import { DesktopVaultLinks } from "./links/DesktopVaultLinks";
import { useLinkDisplayPrefs } from "./links/useLinkDisplayPrefs";
import { useAppLinks } from "./links/useAppLinks";
import { DesktopVaultTagRename } from "./tags/DesktopVaultTagRename";
import { useAppTags } from "./tags/useAppTags";
import { usePalettePick } from "./palette/usePalettePick";
import {
  addRecentVault,
  getExpandedFolders,
  getLinksSettings,
  getTagsSettings,
  getLastVaultPath,
  getNavigatorCollapsed,
  getPreferences,
  getRecentVaults,
  getTheme,
  removeRecentVault,
  setExpandedFolders as saveExpandedFolders,
  setNavigatorCollapsed as saveNavigatorCollapsed,
  setTheme,
  updatePreferences,
} from "./vault/preferences";
import { getDefaultBackgroundPattern } from "./vault/paperDefaults";
import { getNewDrawingPageSetup } from "./vault/pageDefaults";
import { getPageSetupPatch } from "./page/pageSetupChange";
import { isPageCommandChecked } from "./page/pageStatus";
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
  rebaseFolderPath,
  scanVaultMetadata,
} from "./vault/treeStore";
import { useVaultDocument } from "./vault/useVaultDocument";
import { useAppearance } from "./vault/useAppearance";
import { runZoomCommand, useInterfaceZoom } from "./vault/useInterfaceZoom";
import { useVaultSettings } from "./vault/useVaultSettings";
import { tagQuery } from "./tags/types";
import { useTemplates } from "./templates/useTemplates";
import { isInTemplatesFolder } from "./templates/listTemplates";
import {
  ensureFolder,
  folderChain,
  resolveNewDrawingParent,
} from "./vault/newDrawing";
import { commitCanvasTextEdit } from "./commands/context";
import { appCommandHandlers } from "./commands/useAppCommands";
import {
  useCommandDispatcher,
  type CommandRunner,
} from "./commands/useCommands";
import { drawingOpenCommandId } from "./commands/drawingCommands";
import { useCommandShortcutLookup } from "./commands/useCommandShortcut";
import {
  collectPaletteItems,
  registerPaletteProvider,
} from "./palette/registry";
import { focusCanvasIfIdle } from "./palette/focus";
import { createCommandsProvider } from "./palette/providers/commands";
import { createThemesProvider } from "./palette/providers/themes";
import { resolveSelectedTheme } from "./theme/registry";
import { GraphHost, type GraphHostProps } from "./graph/GraphHost";
import { useGraphEntry } from "./graph/useGraphEntry";
import { HistoryHost } from "./history/HistoryHost";
import { desktopHistoryRepository } from "./history/DesktopHistoryRepository";
import { toHistorySettings } from "./history/historySettings";
import { LibraryStore } from "./library/libraryStore";
import { desktopLibraryRepository } from "./library/DesktopLibraryRepository";
import VaultEditor from "./editor/VaultEditor";
import { VaultHeader } from "./components/VaultHeader";
import {
  VaultNavigator,
  type NavigatorAction,
  type NavigatorRequest,
} from "./components/VaultNavigator";
import { useExplorerExport } from "./export/useExplorerExport";
import { Onboarding } from "./components/Onboarding";
import { ConflictDialog } from "./components/ConflictDialog";
import { RecoveryDialog } from "./components/RecoveryDialog";

import { QuickSwitcher } from "./components/QuickSwitcher";
import { ConfirmModal } from "./components/ConfirmModal";
import {
  IconClose,
  IconDrawing,
  IconPlus,
  IconTemplate,
} from "./components/Icons";

import "./components/VaultShell.css";

import type { SettingsTarget } from "./components/settings/schema";
import type { PaletteMode } from "./palette/rank";
import type { PaletteItem } from "./palette/types";
import type { SortOrder } from "./vault/sortOrder";
import type { VaultSearch } from "./search/types";
import type { VaultLinks } from "./links/types";
import type { VaultTagRename } from "./tags/types";

import type { LibraryRepository } from "./library/types";
import type { HistoryRepository } from "./history/types";
import type {
  VaultChange,
  VaultEntry,
  VaultInfo,
  VaultRepository,
} from "./vault/types";

// The dock loads on demand: nothing about links is in the startup bundle.
const LinksDock = lazy(() =>
  import("./components/links/LinksDock").then((m) => ({
    default: m.LinksDock,
  })),
);

// Settings (every page, the Links and Hotkeys editors) stay out of the
// startup chunk; prefetchSettings loads them once the vault is idle, so the
// first Cmd+, still opens in the same frame. A prefetched module renders
// directly: lazy() always suspends once, and React holds a shown fallback
// for 300 ms.
type SettingsModalModule = typeof import("./components/settings/SettingsModal");
let settingsModule: SettingsModalModule | null = null;
const loadSettingsModal = () =>
  import("./components/settings/SettingsModal").then((m) => {
    settingsModule = m;
    return m;
  });
const LazySettingsModal = lazy(() =>
  loadSettingsModal().then((m) => ({ default: m.SettingsModal })),
);
const prefetchSettings = () => {
  const ric = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  const run = () => void loadSettingsModal().catch(() => {});
  if (ric) {
    ric(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1500);
  }
};

export interface VaultAppProps {
  ownerDocument?: Document | null;
  ownerWindow?: Window | null;
  repository?: VaultRepository;
  /** Vault-wide search; defaults to the native index under Tauri, else name-only. */
  search?: VaultSearch | null;
  /** Link index; defaults to the native one under Tauri, else none. */
  links?: VaultLinks | null;
  /** Tag rename client; defaults to the native one under Tauri, else none. */
  tagRename?: VaultTagRename | null;
  initialVault?: VaultInfo | null;
  libraryRepository?: LibraryRepository;
  /** File history; defaults to the native service. */
  history?: HistoryRepository;
  /** Tests / e2e: graph source and settings transport instead of the native ones. */
  graph?: Pick<GraphHostProps, "graphSource" | "invoke" | "onSession">;
}

export const VaultApp = ({
  ownerDocument: propDoc,
  ownerWindow: propWin,
  repository = desktopRepository,
  search,
  links,
  tagRename,
  initialVault = null,
  libraryRepository = desktopLibraryRepository,
  history = desktopHistoryRepository,
  graph,
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
  const defaultLinks = useMemo(
    () => (isTauriAvailable(win) ? new DesktopVaultLinks() : null),
    [win],
  );
  const vaultLinks = links === undefined ? defaultLinks : links;
  const defaultTagRename = useMemo(
    () => (isTauriAvailable(win) ? new DesktopVaultTagRename() : null),
    [win],
  );
  const vaultTagRename = tagRename === undefined ? defaultTagRename : tagRename;
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
  // Picked when the modal opens, so an open modal never remounts.
  const SettingsModal = useMemo(
    () =>
      (showSettingsModal && settingsModule?.SettingsModal) || LazySettingsModal,
    [showSettingsModal],
  );
  const [settingsPage, setSettingsPage] = useState<SettingsTarget | undefined>(
    undefined,
  );
  // The palette and the mode it opened in (Cmd+P files, Cmd+Shift+P
  // commands); providers are asked when commands mode is first shown.
  const [switcher, setSwitcher] = useState<PaletteMode | null>(null);
  // One-shot navigator actions triggered from the palette.
  const [navigatorRequest, setNavigatorRequest] =
    useState<NavigatorRequest | null>(null);
  const requestNavigator = (action: NavigatorAction) =>
    setNavigatorRequest((prev) => ({
      ...action,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  // Colour theme + mode: tokens, html.dark, canvas sync (see useAppearance).
  const appearance = useAppearance(doc, win);
  const { refresh: refreshAppearance } = appearance;
  const appTheme = appearance.snapshot.mode;
  useInterfaceZoom(win);
  // Per-vault settings.toml overrides merged over config.toml (vault > global).
  const vaultSettings = useVaultSettings(win, vault);
  const { navigatorSort, newDrawingFolder, templatesFolder } =
    vaultSettings.effective;
  // One preferences read per render (localStorage parse + normalise).
  const prefsNow = getPreferences(win);
  const { confirmDelete, showTagChips } = prefsNow;

  const handleCanvasThemeChange = useCallback(
    (newTheme: "light" | "dark" | "system") => {
      setTheme(newTheme, win);
      refreshAppearance();
    },
    [win, refreshAppearance],
  );

  // Stable identities keep VaultEditor's memo intact across autosave status ticks.
  const exportEditorFile = useCallback(
    (name: string, bytes: Uint8Array) => repository.exportFile(name, bytes),
    [repository],
  );

  const vaultOpen = vault !== null;
  useEffect(() => {
    if (vaultOpen) {
      prefetchSettings();
    }
  }, [vaultOpen]);

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
    autosaveDelayMs: prefsNow.autosaveDelayMs,
    history,
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

  // Explicit Save action wired to flushDoc (file.save command and UI Save button)
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

  // Keep cached listings and expanded folders in step with a folder that was
  // moved (`to`) or removed (`to === null`), along with everything inside it.
  const rebaseFolders = useCallback(
    (from: string, to: string | null) => {
      if (!vault) {
        return;
      }
      setDirectoryMap((prev) => {
        const next = new Map<string, VaultEntry[]>();
        for (const [dir, items] of prev) {
          const rebased = rebaseFolderPath(dir, from, to);
          if (rebased !== null && (rebased === dir || !prev.has(rebased))) {
            next.set(rebased, items);
          }
        }
        return next;
      });
      setExpandedFolders((prev) => {
        const next = new Set<string>();
        for (const dir of prev) {
          const rebased = rebaseFolderPath(dir, from, to);
          if (rebased !== null) {
            next.add(rebased);
          }
        }
        saveExpandedFolders(vault.path, Array.from(next), win);
        return next;
      });
    },
    [vault, win],
  );

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
        if (gen !== vaultGeneration.current) {
          return;
        }
        if (dirPath !== "" && isNotFoundError(err)) {
          // Moved, renamed or deleted (here or outside the app): not an error.
          rebaseFolders(dirPath, null);
          return;
        }
        setGlobalAlert({
          message: `Could not load folder "${
            dirPath || "root"
          }": ${errorMessage(err)}`,
          type: "error",
        });
      }
    },
    [repository, vault, rebaseFolders],
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
  /** False when the open failed (an alert says why). */
  const handleOpenDrawing = async (drawingPath: string) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await openDoc(drawingPath);
      return true;
    } catch (err) {
      setGlobalAlert({
        message: `Failed to open drawing: ${errorMessage(err)}`,
        type: "error",
      });
      return false;
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
      const paper = {
        viewBackgroundColor:
          prefs.defaultCanvasBackground ||
          (appTheme === "dark" ? "#121212" : "#ffffff"),
        viewBackgroundPattern: getDefaultBackgroundPattern(win),
        pageSetup: null,
      };
      // Page mode default: the paper theme stamps the page colours
      const pageSetup = getNewDrawingPageSetup(win);
      const initialAppState = {
        theme: appTheme,
        ...paper,
        ...(pageSetup && getPageSetupPatch(paper, pageSetup)),
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
  // Resolves the parent folder for a new drawing (creating the default
  // folder when missing). null = aborted (error already shown).
  const prepareNewDrawingParent = async (): Promise<string | null> => {
    if (!vault) {
      return null;
    }
    const parent = resolveNewDrawingParent(
      newDrawingFolder,
      activeDoc?.path ?? null,
    );
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
        return null;
      }
    }
    return parent;
  };

  const handleNewDrawing = async () => {
    const parent = await prepareNewDrawingParent();
    if (parent !== null) {
      await handleCreateDrawing(
        parent,
        `Drawing-${Date.now().toString().slice(-4)}.excalidraw`,
      );
    }
  };

  // Create a drawing from a ready scene JSON (templates).
  const handleCreateFromJson = async (
    parentPath: string,
    name: string,
    json: string,
  ) => {
    setIsBusy(true);
    setGlobalAlert(null);
    try {
      await createDoc(parentPath, name, undefined, json);
      await loadDirectory(parentPath);
      handleExpandFolder(parentPath);
      startIndexing();
    } finally {
      setIsBusy(false);
    }
  };

  const templates = useTemplates({
    repository,
    vault,
    folder: templatesFolder,
    doc,
    theme: appTheme,
    activePath: activeDoc?.path ?? null,
    flushActive: () => flushDoc({ commitText: false }),
    prepareParent: prepareNewDrawingParent,
    createFromJson: handleCreateFromJson,
    newBlank: () => void handleNewDrawing(),
    onError: (message) => setGlobalAlert({ message, type: "error" }),
  });
  const { openPicker: openTemplatePicker } = templates;

  // Links: history, dock, create, links-aware rename/move, commands.
  useLinkDisplayPrefs(win); // palette toggles re-render with the new prefs
  const linksSettings = useMemo(
    () => getLinksSettings(prefsNow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      prefsNow.linkNewFormat,
      prefsNow.linkShapeFormat,
      prefsNow.linkOpenModifier,
      prefsNow.linkUpdateOnRename,
      prefsNow.linkAutocomplete,
      prefsNow.linkHintChars,
      prefsNow.linkStyle,
      prefsNow.linkColor,
      prefsNow.linkHoverPreview,
    ],
  );
  const palettePick = usePalettePick();
  const appLinks = useAppLinks({
    links: vaultLinks,
    search: vaultSearch,
    repository,
    vault,
    win,
    doc,
    settings: linksSettings,
    entries: allIndexedEntries,
    indexing: isIndexing,
    activePath: activeDoc?.path ?? null,
    navigatorCollapsed,
    open: handleOpenSearchResult
      ? (path, elementId) =>
          handleOpenSearchResult(
            path,
            elementId ? { elementId, containerId: null } : undefined,
          )
      : async () => {},
    prepareParent: prepareNewDrawingParent,
    createDrawing: handleCreateDrawing,
    loadDirectory,
    expandFolder: handleExpandFolder,
    showNavigator: () => showNavigator(),
    openHotkeys: () => openSettings("hotkeys"),
    notify: (message, type) => {
      setGlobalAlert({ message, type });
      if (type === "info") {
        (win ?? window).setTimeout(
          () => setGlobalAlert((a) => (a?.message === message ? null : a)),
          6000,
        );
      }
    },
  });
  const tagsSettings = useMemo(
    () => getTagsSettings(prefsNow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefsNow.tagAutocomplete, prefsNow.tagPaneSort],
  );
  const appTags = useAppTags({
    api: vaultTagRename,
    links: vaultLinks,
    handle: vault?.handle ?? null,
    activePath: activeDoc?.path ?? null,
    bridge: appLinks.bridge,
    flushActive: () => flushDoc({ commitText: false }),
    notify: (message, type) => {
      setGlobalAlert({ message, type });
      if (type === "info") {
        (win ?? window).setTimeout(
          () => setGlobalAlert((a) => (a?.message === message ? null : a)),
          6000,
        );
      }
    },
    doc,
  });
  const editorLinks = useMemo(
    () =>
      vaultLinks
        ? {
            settings: linksSettings,
            tagsSettings,
            names: appLinks.names,
            currentPath: activeDoc?.path ?? null,
            callbacks: appLinks.editorCallbacks,
            links: vaultLinks,
            handle: vault?.handle ?? null,
            pickDrawing: palettePick.pickDrawing,
            bridge: appLinks.bridge,
            remeasureIds: appLinks.remeasureIdsFor(activeDoc?.path ?? null),
            onRemeasured: () => appLinks.onRemeasured(activeDoc?.path ?? null),
            readDrawing: (path: string) =>
              vault
                ? repository.readDrawing(vault.handle, path)
                : Promise.reject(new Error("no vault")),
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      vaultLinks,
      linksSettings,
      tagsSettings,
      appLinks.names,
      appLinks.editorCallbacks,
      activeDoc?.path,
      vault?.handle,
      palettePick.pickDrawing,
    ],
  );

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

  // One path for rename, move and drag-and-drop: links-aware (see useAppLinks).
  // The open drawing is flushed and relocated by relocateDoc as before.
  const moveWithLinks = (from: string, to: string) =>
    appLinks.moveEntry(from, to, (move) =>
      activeDoc &&
      (activeDoc.path === from || activeDoc.path.startsWith(`${from}/`))
        ? relocateDoc(from, to, move)
        : move(from, to).then(() => undefined),
    );

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

      if (!(await moveWithLinks(oldPath, newPath))) {
        return;
      }
      rebaseFolders(oldPath, newPath);
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

      if (!(await moveWithLinks(sourcePath, newPath))) {
        return;
      }
      rebaseFolders(sourcePath, newPath);
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
      rebaseFolders(path, null);
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

  const handleExportDrawing = useExplorerExport({
    repository,
    vault,
    win: win as (Window & typeof globalThis) | null,
    dark: appTheme === "dark",
    flushIfOpen: async (path) => {
      if (activeDoc?.path === path) {
        await flushDoc({ commitText: false });
      }
    },
    setAlert: setGlobalAlert,
  });

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

  const openSettings = useCallback((page?: SettingsTarget) => {
    setSettingsPage(page);
    setShowSettingsModal(true);
  }, []);

  const showNavigator = () => {
    commitCanvasTextEdit(doc);
    setNavigatorCollapsed((collapsed) => {
      if (collapsed) {
        saveNavigatorCollapsed(false, win);
      }
      return false;
    });
  };

  const focusNavigatorSearch = () => {
    showNavigator();
    setSearchFocusNonce((n) => n + 1);
  };

  // Write where the value currently lives: this vault if it overrides the
  // global order, else config.toml.
  const handleSortChange = (order: SortOrder) => {
    if (vaultSettings.isOverridden("navigatorSort")) {
      void vaultSettings.setOverride("navigatorSort", order);
    } else {
      updatePreferences({ navigatorSort: order }, win);
    }
  };

  // Graph view (D14): it takes over the canvas area; the editor stays mounted
  // but frozen (no key or pointer handling) and hidden, so closing is instant.
  const [graphOpen, setGraphOpen] = useState(false);
  const shortcutLabel = useCommandShortcutLookup(win);
  const graphShortcutFor = useCallback(
    (path: string) => shortcutLabel(drawingOpenCommandId(path)) || null,
    [shortcutLabel],
  );
  const focusCanvas = useCallback(
    () =>
      doc
        ?.querySelector<HTMLElement>(".vault-editor .excalidraw-container")
        ?.focus({ preventScroll: true }),
    [doc],
  );

  const runnerRef = useRef<CommandRunner | null>(null);
  const idle = !isBusy && !isClosing;
  const commandHandlers = appCommandHandlers({
    // The save chords never reach Excalidraw (so Cmd+Shift+S can't start its
    // "Save to disk" download). Commit a text edit first, then save after
    // Excalidraw has published the committed scene.
    save: async () => {
      commitCanvasTextEdit(doc);
      await new Promise((resolve) => (win ?? window).setTimeout(resolve, 0));
      return handleExplicitSave();
    },
    openSettings: () => openSettings(),
    openHotkeySettings: () => openSettings("hotkeys"),
    focusSearch: focusNavigatorSearch,
    zoom: (command) => runZoomCommand(command, win),
    toggleNavigator: handleToggleNavigator,
    newDrawing: () => {
      if (idle) {
        return handleNewDrawing();
      }
    },
    newFromTemplate: () => openTemplatePicker(),
    switchVault: () => {
      if (idle) {
        return handleSwitchVault();
      }
    },
    revealActive: () => {
      if (activeDoc) {
        return handleRevealEntry(activeDoc.path);
      }
    },
    duplicateActive: () => {
      if (activeDoc && idle) {
        return handleDuplicateDrawing(activeDoc.path);
      }
    },
    toggleMode: () =>
      handleCanvasThemeChange(appTheme === "dark" ? "light" : "dark"),
    togglePalette: (mode) => {
      if (!switcher) {
        commitCanvasTextEdit(doc);
      }
      // While it is open the palette handles its own keys (same mode closes,
      // the other switches); this path only sees it open via Mod+Enter.
      setSwitcher((open) => (open ? null : mode));
    },
    openSettingsPage: openSettings,
    setMode: handleCanvasThemeChange,
    setSyncCanvas: (on) => {
      updatePreferences({ syncCanvas: on }, win);
      refreshAppearance();
    },
    exportActive: (format) => {
      if (activeDoc) {
        return handleExportDrawing(activeDoc.path, format);
      }
    },
    saveActiveAsTemplate: () => {
      if (activeDoc) {
        templates.requestSave(activeDoc.path);
      }
    },
    searchTags: () => {
      showNavigator();
      requestNavigator({ kind: "search", query: tagQuery("") });
    },
    newFolder: () => requestNavigator({ kind: "newFolder" }),
    renameActive: () => {
      if (activeDoc) {
        requestNavigator({ kind: "rename", path: activeDoc.path });
      }
    },
    moveActive: () => {
      if (activeDoc) {
        requestNavigator({ kind: "move", path: activeDoc.path });
      }
    },
    trashActive: () => {
      if (activeDoc) {
        requestNavigator({ kind: "trash", path: activeDoc.path });
      }
    },
    revealVault: () => handleRevealEntry(""),
    setSort: handleSortChange,
    openRecovered:
      recoveryCount > 0 ? () => setShowRecoveryDialog(true) : undefined,
    resolveConflict:
      saveStatus === "conflict" ? () => setShowConflictDialog(true) : undefined,
  });
  const commandRunner = useCommandDispatcher(doc, win, {
    handlers: commandHandlers,
    app: {
      vaultOpen: vault !== null,
      drawingOpen: activeDoc != null,
      writable: !vault?.readOnly,
    },
  });
  runnerRef.current = commandRunner;
  // UI entry points (navigator, main menu, row menu) dispatch the graph commands.
  const runCommand = useCallback(
    (id: string) => runnerRef.current?.run(id) ?? false,
    [],
  );
  const { openGraph, openLocalGraph } = useGraphEntry(
    activeDoc?.path ?? null,
    handleOpenDrawing,
    runCommand,
  );

  // Palette providers read live state through this ref, so the provider
  // objects stay stable and nothing runs while the palette is closed.
  const paletteLive = useRef({
    checked: (_id: string): boolean => false,
    registry: appearance.registry,
    refreshAppearance,
  });
  paletteLive.current = {
    checked: (id) => {
      if (id.startsWith("appearance.mode.")) {
        return getTheme(win) === id.slice("appearance.mode.".length);
      }
      if (id.startsWith("appearance.syncCanvas.")) {
        return getPreferences(win).syncCanvas === id.endsWith(".on");
      }
      if (id.startsWith("navigator.sort.")) {
        return navigatorSort === id.slice("navigator.sort.".length);
      }
      if (id.startsWith("page.")) {
        return isPageCommandChecked(id);
      }
      return false;
    },
    registry: appearance.registry,
    refreshAppearance,
  };
  useEffect(() => {
    const live = () => paletteLive.current;
    const runner = {
      run: (id: string, o?: { fromPalette?: boolean }) =>
        runnerRef.current?.run(id, o) ?? false,
      isAvailable: (id: string, o?: { fromPalette?: boolean }) =>
        runnerRef.current?.isAvailable(id, o) ?? false,
      get platform() {
        return runnerRef.current?.platform ?? "mac";
      },
    };
    const stops = [
      registerPaletteProvider(
        createCommandsProvider({
          runner,
          overrides: () => getPreferences(win).hotkeys,
          checked: (id) => live().checked(id),
        }),
      ),
      registerPaletteProvider(
        createThemesProvider({
          registry: () => live().registry,
          currentKey: () =>
            resolveSelectedTheme(
              live().registry,
              getPreferences(win).colorTheme,
            ).entry.key,
          select: (key) => {
            updatePreferences({ colorTheme: key }, win);
            live().refreshAppearance();
          },
        }),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [win]);

  const closeSwitcher = () => setSwitcher(null);
  const runPaletteItem = (item: PaletteItem, keepOpen: boolean) => {
    const execute = async () => {
      try {
        await item.run();
      } catch (err) {
        console.error(`Palette entry "${item.key}" failed`, err);
      }
    };
    if (keepOpen) {
      void execute();
      return;
    }
    setSwitcher(null);
    // After the palette's backdrop has unmounted, so `!modalOpen` holds.
    const timers = win ?? window;
    timers.setTimeout(() => {
      void execute().then(() =>
        // One more tick so a dialog the entry opened can take focus first.
        timers.setTimeout(() => focusCanvasIfIdle(doc), 0),
      );
    }, 0);
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
    .filter(
      (entry) =>
        entry.kind === "drawing" &&
        !isInTemplatesFolder(entry.path, templatesFolder),
    )
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
        onNewFromTemplate={() => void openTemplatePicker()}
        onOpenConflict={() => setShowConflictDialog(true)}
        onOpenRecovery={() => setShowRecoveryDialog(true)}
        onSave={handleExplicitSave}
      />

      <div className="vault-main">
        <div
          className={`vault-editor-pane ${
            graphOpen ? "vault-editor-pane--graph" : ""
          }`}
        >
          {activeDoc ? (
            <div
              inert={graphOpen}
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
                onExport={exportEditorFile}
                readOnly={
                  vault.readOnly ||
                  isBusy ||
                  isClosing ||
                  docHook.loading ||
                  graphOpen
                }
                disabled={isBusy || isClosing || docHook.loading || graphOpen}
                theme={appTheme}
                onThemeChange={handleCanvasThemeChange}
                onOpenSettings={openSettings}
                onOpenGraph={openGraph}
                focusRequest={
                  focusRequest?.path === activeDoc.path ? focusRequest : null
                }
                library={libraryBundle}
                links={editorLinks}
              />
            </div>
          ) : (
            <div className="vault-empty-state" inert={graphOpen}>
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
              {!vault.readOnly && (
                <button
                  type="button"
                  className="vault-btn"
                  onClick={() => void openTemplatePicker()}
                >
                  <IconTemplate />
                  <span>New from template…</span>
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
          <GraphHost
            handle={vault.handle}
            currentPath={activeDoc?.path ?? null}
            themeKey={appearance.snapshot.key}
            shortcutFor={graphShortcutFor}
            onOpenDrawing={(path) =>
              path === activeDoc?.path ? undefined : handleOpenDrawing(path)
            }
            onOpenChange={setGraphOpen}
            onClosed={focusCanvas}
            {...graph}
          />
        </div>

        <HistoryHost
          repository={history}
          vault={vault}
          settings={toHistorySettings(vaultSettings.effective)}
          document={activeDoc}
          flush={() => flushDoc({ commitText: false })}
          ownerDocument={doc}
          status={saveStatus}
          onOpenDrawing={handleOpenDrawing}
          theme={appTheme}
          onSaveFile={exportEditorFile}
        />
        {templates.dialogs}
        {appLinks.dialogs}
        {appTags.dialog}
        <VaultNavigator
          vault={vault}
          activePath={activeDoc?.path ?? null}
          collapsed={navigatorCollapsed}
          onToggleCollapse={handleToggleNavigator}
          onOpenSettings={() => openSettings()}
          onOpenGraph={openGraph}
          graphOpen={graphOpen}
          onOpenLocalGraph={openLocalGraph}
          onOpenDrawing={handleOpenDrawing}
          search={vaultSearch}
          onOpenSearchResult={handleOpenSearchResult}
          searchFocusNonce={searchFocusNonce}
          request={navigatorRequest}
          onCreateDrawing={handleCreateDrawing}
          onCreateFolder={handleCreateFolder}
          onRenameEntry={handleRenameEntry}
          onMoveEntry={handleMoveEntry}
          onDuplicateDrawing={handleDuplicateDrawing}
          onSaveAsTemplate={templates.requestSave}
          onTrashEntry={handleTrashEntry}
          onRevealEntry={handleRevealEntry}
          onExportDrawing={handleExportDrawing}
          onSwitchVault={handleSwitchVault}
          sortOrder={navigatorSort}
          onSortChange={handleSortChange}
          confirmDelete={confirmDelete}
          showTagChips={showTagChips}
          tagsDefaultSort={tagsSettings.paneSort}
          onRenameTag={vaultTagRename ? appTags.renameTag : undefined}
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
          dockSlot={
            vaultLinks && appLinks.dockVisible ? (
              <Suspense fallback={null}>
                <LinksDock
                  ref={appLinks.dockRef}
                  links={vaultLinks}
                  handle={vault.handle}
                  path={activeDoc?.path ?? null}
                  refreshKey={appLinks.refreshKey}
                  onOpen={(path, elementId) =>
                    void appLinks.openLink(path, elementId)
                  }
                  onCreate={(target) => void appLinks.createTarget(target)}
                  visible={!navigatorCollapsed}
                />
              </Suspense>
            ) : null
          }
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
        <Suspense fallback={null}>
          <SettingsModal
            vault={vault}
            initialPage={settingsPage}
            onClose={() => setShowSettingsModal(false)}
            onAppearanceChanged={refreshAppearance}
            pickDrawing={
              vaultLinks ? () => palettePick.pickDrawing() : undefined
            }
            themeRegistry={appearance.registry}
            onRevealVault={(path) => {
              void handleRevealEntry(path);
            }}
            ownerDocument={doc}
          />
        </Suspense>
      )}

      {(switcher || palettePick.pick) && (
        <QuickSwitcher
          key={palettePick.pick ? "pick" : "palette"}
          search={vaultSearch}
          handle={vault.handle}
          fallbackPaths={allIndexedEntries
            .filter((e) => e.kind === "drawing")
            .map((e) => e.path)
            .sort()}
          initialMode={palettePick.pick ? "files" : switcher ?? "files"}
          pickLabel={palettePick.pick?.label}
          collectItems={collectPaletteItems}
          platform={commandRunner.platform}
          onOpenDrawing={(path) => {
            if (palettePick.pick) {
              palettePick.finish(path);
              return;
            }
            setSwitcher(null);
            void handleOpenDrawing(path);
          }}
          onRunItem={runPaletteItem}
          onClose={() => {
            if (palettePick.pick) {
              palettePick.finish(null);
            }
            closeSwitcher();
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
