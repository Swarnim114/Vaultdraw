import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";

import { muteFSAbortError, randomId } from "@excalidraw/common";

import { useUIAppState } from "../context/ui-appState";
import { fileOpen } from "../data/filesystem";
import { loadLibraryFromBlob } from "../data/blob";
import { saveLibraryAsJSON } from "../data/json";
import {
  getUniqueLibraryItems,
  libraryItemsAtom,
  resolveLibrarySectionId,
} from "../data/library";
import { useAtom, useSetAtom } from "../editor-jotai";
import { useLibraryCache } from "../hooks/useLibraryItemSvg";
import { t } from "../i18n";

import { useApp, useAppProps, useExcalidrawSetAppState } from "./App";
import ConfirmDialog from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { isLibraryMenuOpenAtom } from "./LibraryMenu";
import { libraryItemRenamingAtom } from "./LibraryUnit";
import PublishLibrary from "./PublishLibrary";
import { IconButton } from "./IconButton";
import Trans from "./Trans";
import DropdownMenu from "./dropdownMenu/DropdownMenu";
import {
  DotsIcon,
  ExportIcon,
  LoadIcon,
  copyIcon,
  ArrowRightIcon,
  pencilIcon,
  publishIcon,
  TrashIcon,
} from "./icons";

import type Library from "../data/library";
import type {
  LibraryItem,
  LibraryItems,
  LibraryUIOptions,
  UIAppState,
} from "../types";

const getSelectedItems = (
  libraryItems: LibraryItems,
  selectedItems: LibraryItem["id"][],
) => libraryItems.filter((item) => selectedItems.includes(item.id));

export const LibraryDropdownMenuButton: React.FC<{
  setAppState: React.Component<any, UIAppState>["setState"];
  selectedItems: LibraryItem["id"][];
  library: Library;
  onRemoveFromLibrary: () => void;
  resetLibrary: () => void;
  onSelectItems: (items: LibraryItem["id"][]) => void;
  appState: UIAppState;
  libraryUIOptions?: LibraryUIOptions;
  className?: string;
}> = ({
  setAppState,
  selectedItems,
  library,
  onRemoveFromLibrary,
  resetLibrary,
  onSelectItems,
  appState,
  libraryUIOptions,
  className,
}) => {
  const { deleteItemsFromLibraryCache } = useLibraryCache();
  const sections = libraryUIOptions?.sections;
  const online = libraryUIOptions?.online !== false;
  const [clearSectionId, setClearSectionId] = useState<string | null>(null);
  const setRenamingId = useSetAtom(libraryItemRenamingAtom);
  const [libraryItemsData] = useAtom(libraryItemsAtom);
  const [isLibraryMenuOpen, setIsLibraryMenuOpen] = useAtom(
    isLibraryMenuOpenAtom,
  );

  const renderRemoveLibAlert = () => {
    const content = selectedItems.length
      ? selectedItems.length === 1
        ? t("alerts.removeItemFromLibrary")
        : t("alerts.removeItemsFromsLibrary", { count: selectedItems.length })
      : t("alerts.resetLibrary");
    const title = selectedItems.length
      ? t("confirmDialog.removeItemsFromLib")
      : t("confirmDialog.resetLibrary");
    return (
      <ConfirmDialog
        onConfirm={() => {
          if (selectedItems.length) {
            onRemoveFromLibrary();
          } else {
            resetLibrary();
          }
          setShowRemoveLibAlert(false);
        }}
        onCancel={() => {
          setShowRemoveLibAlert(false);
        }}
        title={title}
        confirmText={
          selectedItems.length ? t("buttons.remove") : t("buttons.confirm")
        }
      >
        <p>{content}</p>
      </ConfirmDialog>
    );
  };

  const [showRemoveLibAlert, setShowRemoveLibAlert] = useState(false);

  const itemsSelected = !!selectedItems.length;
  const items = itemsSelected
    ? libraryItemsData.libraryItems.filter((item) =>
        selectedItems.includes(item.id),
      )
    : libraryItemsData.libraryItems;
  const resetLabel = itemsSelected
    ? t("buttons.remove")
    : t("buttons.resetLibrary");

  const [showPublishLibraryDialog, setShowPublishLibraryDialog] =
    useState(false);
  const [publishLibSuccess, setPublishLibSuccess] = useState<null | {
    url: string;
    authorName: string;
  }>(null);
  const renderPublishSuccess = useCallback(() => {
    return (
      <Dialog
        onCloseRequest={() => setPublishLibSuccess(null)}
        title={t("publishSuccessDialog.title")}
        className="publish-library-success"
        size="small"
      >
        <p>
          <Trans
            i18nKey="publishSuccessDialog.content"
            authorName={publishLibSuccess!.authorName}
            link={(el) => (
              <a
                href={publishLibSuccess?.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {el}
              </a>
            )}
          />
        </p>
        <IconButton
          type="button"
          title={t("buttons.close")}
          aria-label={t("buttons.close")}
          label={t("buttons.close")}
          onClick={() => setPublishLibSuccess(null)}
          data-testid="publish-library-success-close"
          className="publish-library-success-close"
        />
      </Dialog>
    );
  }, [setPublishLibSuccess, publishLibSuccess]);

  const onPublishLibSuccess = (
    data: { url: string; authorName: string },
    libraryItems: LibraryItems,
  ) => {
    setShowPublishLibraryDialog(false);
    setPublishLibSuccess({ url: data.url, authorName: data.authorName });
    const nextLibItems = libraryItems.slice();
    nextLibItems.forEach((libItem) => {
      if (selectedItems.includes(libItem.id)) {
        libItem.status = "published";
      }
    });
    library.setLibrary(nextLibItems);
  };

  const pickFile = (): Promise<Blob | null> =>
    libraryUIOptions?.pickLibraryFile
      ? libraryUIOptions.pickLibraryFile()
      : fileOpen({
          description: "Excalidraw library files",
        });

  const saveFile = (items: LibraryItems, suggestedName: string) =>
    libraryUIOptions?.saveLibraryFile
      ? libraryUIOptions.saveLibraryFile(items, suggestedName)
      : saveLibraryAsJSON(items);

  const onLibraryImport = async () => {
    try {
      await library.updateLibrary({
        libraryItems: fileOpen({
          description: "Excalidraw library files",
          // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
          // gets resolved. Else, iOS users cannot open `.excalidraw` files.
          /*
            extensions: [".json", ".excalidrawlib"],
            */
        }),
        merge: true,
        openLibraryMenu: true,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        console.warn(error);
        return;
      }
      setAppState({ errorMessage: t("errors.importLibraryError") });
    }
  };

  const onLibraryExport = async () => {
    const libraryItems = itemsSelected
      ? items
      : await library.getLatestLibrary();
    saveFile(libraryItems, itemsSelected ? "library-selection" : "library")
      .catch(muteFSAbortError)
      .catch((error) => {
        setAppState({ errorMessage: error.message });
      });
  };

  // ---- sections (only used when the host provides `sections`) -------------

  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (sections) {
      for (const item of libraryItemsData.libraryItems) {
        const id = resolveLibrarySectionId(sections, item.id);
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    return counts;
  }, [sections, libraryItemsData.libraryItems]);

  const addableSections = sections
    ? sections.list.filter((section) => section.canAdd !== false)
    : [];

  // targets that differ from the section of at least one selected item
  const selectedSectionIds = new Set<string>();
  if (sections && itemsSelected) {
    for (const item of items) {
      selectedSectionIds.add(resolveLibrarySectionId(sections, item.id));
    }
  }
  const transferTargets = addableSections.filter(
    (section) =>
      selectedSectionIds.size > 1 || !selectedSectionIds.has(section.id),
  );

  const reportError = (error: any) => {
    if (error?.name === "AbortError") {
      console.warn(error);
      return;
    }
    setAppState({
      errorMessage: error?.message || t("errors.importLibraryError"),
    });
  };

  const sanitizeName = (label: string) =>
    label.replace(/[^\p{L}\p{N}_ -]+/gu, "").trim() || "library";

  const onMoveToSection = (sectionId: string) => {
    sections!.assign(selectedItems, sectionId);
    // new array identity so the sidebar re-renders even if the host's
    // `sections` object stays the same
    library.setLibrary((latest) => latest.slice());
    onSelectItems([]);
  };

  const onCopyToSection = (sectionId: string) => {
    const ids = new Set(selectedItems);
    library
      .setLibrary((latest) => {
        const copies = latest
          .filter((item) => ids.has(item.id))
          .map((item) => ({
            ...item,
            id: randomId(),
            created: Date.now(),
          }));
        sections!.assign(
          copies.map((item) => item.id),
          sectionId,
        );
        return [...copies, ...latest];
      })
      .catch(reportError);
    onSelectItems([]);
  };

  const onImportIntoSection = async (sectionId: string) => {
    try {
      const blob = await pickFile();
      if (!blob) {
        return;
      }
      const loaded = await loadLibraryFromBlob(blob, "unpublished");
      await library.setLibrary((latest) => {
        const unique = getUniqueLibraryItems(latest, loaded);
        sections!.assign(
          unique.map((item) => item.id),
          sectionId,
        );
        return [...unique, ...latest];
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        console.warn(error);
        return;
      }
      setAppState({ errorMessage: t("errors.importLibraryError") });
    }
  };

  const onExportSection = async (sectionId: string, label: string) => {
    const latest = await library.getLatestLibrary();
    saveFile(
      latest.filter(
        (item) => resolveLibrarySectionId(sections!, item.id) === sectionId,
      ),
      sanitizeName(label),
    )
      .catch(muteFSAbortError)
      .catch(reportError);
  };

  const onClearSection = (sectionId: string) => {
    const removed: LibraryItem["id"][] = [];
    library
      .setLibrary((latest) =>
        latest.filter((item) => {
          if (resolveLibrarySectionId(sections!, item.id) === sectionId) {
            removed.push(item.id);
            return false;
          }
          return true;
        }),
      )
      .then(() => deleteItemsFromLibraryCache(removed))
      .catch(() => {
        setAppState({ errorMessage: t("alerts.errorRemovingFromLibrary") });
      });
  };

  const renderSectionItems = () => {
    if (!sections) {
      return null;
    }
    if (itemsSelected) {
      return (
        <>
          {transferTargets.map((section) => (
            <DropdownMenu.Item
              key={`move-${section.id}`}
              onSelect={() => onMoveToSection(section.id)}
              icon={ArrowRightIcon}
              data-testid={`lib-dropdown--move-${section.id}`}
            >
              {t("library.moveTo", { label: section.label })}
            </DropdownMenu.Item>
          ))}
          {transferTargets.map((section) => (
            <DropdownMenu.Item
              key={`copy-${section.id}`}
              onSelect={() => onCopyToSection(section.id)}
              icon={copyIcon}
              data-testid={`lib-dropdown--copy-${section.id}`}
            >
              {t("library.copyTo", { label: section.label })}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Item
            onSelect={onLibraryExport}
            icon={ExportIcon}
            data-testid="lib-dropdown--export"
          >
            {t("library.exportSelected")}
          </DropdownMenu.Item>
        </>
      );
    }
    return (
      <>
        {addableSections.map((section) => (
          <DropdownMenu.Item
            key={`import-${section.id}`}
            onSelect={() => onImportIntoSection(section.id)}
            icon={LoadIcon}
            data-testid={`lib-dropdown--import-${section.id}`}
          >
            {t("library.importInto", { label: section.label })}
          </DropdownMenu.Item>
        ))}
        {sections.list
          .filter((section) => sectionCounts.get(section.id))
          .map((section) => (
            <DropdownMenu.Item
              key={`export-${section.id}`}
              onSelect={() => onExportSection(section.id, section.label)}
              icon={ExportIcon}
              data-testid={`lib-dropdown--export-${section.id}`}
            >
              {t("library.exportSection", { label: section.label })}
            </DropdownMenu.Item>
          ))}
        {sections.list
          .filter((section) => sectionCounts.get(section.id))
          .map((section) => (
            <DropdownMenu.Item
              key={`clear-${section.id}`}
              onSelect={() => setClearSectionId(section.id)}
              icon={TrashIcon}
              data-testid={`lib-dropdown--clear-${section.id}`}
            >
              {t("library.clearSection", { label: section.label })}
            </DropdownMenu.Item>
          ))}
      </>
    );
  };

  const clearSection = sections?.list.find((s) => s.id === clearSectionId);

  const renderLibraryMenu = () => {
    return (
      <DropdownMenu open={isLibraryMenuOpen}>
        <DropdownMenu.Trigger
          onToggle={() => setIsLibraryMenuOpen(!isLibraryMenuOpen)}
        >
          {DotsIcon}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          onClickOutside={() => setIsLibraryMenuOpen(false)}
          onSelect={() => setIsLibraryMenuOpen(false)}
          className="library-menu"
        >
          {libraryUIOptions?.namedItems && selectedItems.length === 1 && (
            <DropdownMenu.Item
              onSelect={() => setRenamingId(selectedItems[0])}
              icon={pencilIcon}
              data-testid="lib-dropdown--rename"
            >
              {t("library.renameItem")}
            </DropdownMenu.Item>
          )}
          {sections && renderSectionItems()}
          {!sections && !itemsSelected && (
            <DropdownMenu.Item
              onSelect={onLibraryImport}
              icon={LoadIcon}
              data-testid="lib-dropdown--load"
            >
              {t("buttons.load")}
            </DropdownMenu.Item>
          )}
          {!sections && !!items.length && (
            <DropdownMenu.Item
              onSelect={onLibraryExport}
              icon={ExportIcon}
              data-testid="lib-dropdown--export"
            >
              {t("buttons.export")}
            </DropdownMenu.Item>
          )}
          {online && itemsSelected && (
            <DropdownMenu.Item
              icon={publishIcon}
              onSelect={() => setShowPublishLibraryDialog(true)}
              data-testid="lib-dropdown--remove"
            >
              {t("buttons.publishLibrary")}
            </DropdownMenu.Item>
          )}
          {(!sections || itemsSelected) && !!items.length && (
            <DropdownMenu.Item
              onSelect={() => setShowRemoveLibAlert(true)}
              icon={TrashIcon}
            >
              {resetLabel}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu>
    );
  };

  return (
    <div className={clsx("library-menu-dropdown-container", className)}>
      {renderLibraryMenu()}
      {selectedItems.length > 0 && (
        <div className="library-actions-counter">{selectedItems.length}</div>
      )}
      {showRemoveLibAlert && renderRemoveLibAlert()}
      {clearSection && (
        <ConfirmDialog
          onConfirm={() => {
            onClearSection(clearSection.id);
            setClearSectionId(null);
          }}
          onCancel={() => setClearSectionId(null)}
          title={t("library.clearSection", { label: clearSection.label })}
        >
          <p>
            {t("library.confirmClearSection", {
              label: clearSection.label,
              count: sectionCounts.get(clearSection.id) || 0,
            })}
          </p>
        </ConfirmDialog>
      )}
      {showPublishLibraryDialog && (
        <PublishLibrary
          onClose={() => setShowPublishLibraryDialog(false)}
          libraryItems={getSelectedItems(
            libraryItemsData.libraryItems,
            selectedItems,
          )}
          appState={appState}
          onSuccess={(data) =>
            onPublishLibSuccess(data, libraryItemsData.libraryItems)
          }
          onError={(error) => window.alert(error)}
          updateItemsInStorage={() =>
            library.setLibrary(libraryItemsData.libraryItems)
          }
          onRemove={(id: string) =>
            onSelectItems(selectedItems.filter((_id) => _id !== id))
          }
        />
      )}
      {publishLibSuccess && renderPublishSuccess()}
    </div>
  );
};

export const LibraryDropdownMenu = ({
  selectedItems,
  onSelectItems,
  className,
}: {
  selectedItems: LibraryItem["id"][];
  onSelectItems: (id: LibraryItem["id"][]) => void;
  className?: string;
}) => {
  const { library } = useApp();
  const libraryUIOptions = useAppProps().libraryUIOptions;
  const { clearLibraryCache, deleteItemsFromLibraryCache } = useLibraryCache();
  const appState = useUIAppState();
  const setAppState = useExcalidrawSetAppState();

  const [libraryItemsData] = useAtom(libraryItemsAtom);

  const removeFromLibrary = async (libraryItems: LibraryItems) => {
    const nextItems = libraryItems.filter(
      (item) => !selectedItems.includes(item.id),
    );
    library.setLibrary(nextItems).catch(() => {
      setAppState({ errorMessage: t("alerts.errorRemovingFromLibrary") });
    });

    deleteItemsFromLibraryCache(selectedItems);

    onSelectItems([]);
  };

  const resetLibrary = () => {
    library.resetLibrary();
    clearLibraryCache();
  };

  return (
    <LibraryDropdownMenuButton
      appState={appState}
      setAppState={setAppState}
      selectedItems={selectedItems}
      onSelectItems={onSelectItems}
      library={library}
      onRemoveFromLibrary={() =>
        removeFromLibrary(libraryItemsData.libraryItems)
      }
      resetLibrary={resetLibrary}
      libraryUIOptions={libraryUIOptions}
      className={className}
    />
  );
};
