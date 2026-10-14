import clsx from "clsx";
import fuzzy from "fuzzy";
import { useEffect, useRef, useMemo, useState } from "react";

import { EVENT, KEYS, isWritableElement } from "@excalidraw/common";

import type { MarkRequired } from "@excalidraw/common/utility-types";

import { getShortcutKey } from "../../shortcut";

import { trackEvent } from "../../analytics";
import { useUIAppState } from "../../context/ui-appState";
import { deburr } from "../../deburr";
import { atom, useAtom } from "../../editor-jotai";
import { t } from "../../i18n";
import {
  useApp,
  useAppProps,
  useExcalidrawActionManager,
  useExcalidrawSetAppState,
} from "../App";
import { Dialog } from "../Dialog";
import { InlineIcon } from "../InlineIcon";
import { TextField } from "../TextField";
import { searchIcon, historyCommandIcon } from "../icons";

import { useStableCallback } from "../../hooks/useStableCallback";
import { useStable } from "../../hooks/useStable";

import { Ellipsify } from "../Ellipsify";

import {
  distributeLibraryItemsOnSquareGrid,
  libraryItemsAtom,
} from "../../data/library";

import {
  useLibraryCache,
  useLibraryItemSvg,
} from "../../hooks/useLibraryItemSvg";

import {
  DEFAULT_CATEGORIES,
  getCategoryOrder,
  getCommandPaletteItems,
  withPaletteDefaults,
  isCommandPaletteItemAvailable,
} from "./commandPaletteItems";
import * as defaultItems from "./defaultCommandPaletteItems";
import "./CommandPalette.scss";

import type { CommandPaletteItem } from "./types";
import type { LibraryItem, UIAppState } from "../../types";

export { DEFAULT_CATEGORIES };

const lastUsedPaletteItem = atom<CommandPaletteItem | null>(null);

const CommandShortcutHint = ({
  shortcut,
  className,
  children,
}: {
  shortcut: string;
  className?: string;
  children?: React.ReactNode;
}) => {
  const shortcuts = shortcut.replace("++", "+$").split("+");

  return (
    <div className={clsx("shortcut", className)}>
      {shortcuts.map((item, idx) => {
        return (
          <div className="shortcut-wrapper" key={item}>
            <div className="shortcut-key">{item === "$" ? "+" : item}</div>
          </div>
        );
      })}
      <div className="shortcut-desc">{children}</div>
    </div>
  );
};

const isCommandPaletteToggleShortcut = (event: KeyboardEvent) => {
  return (
    !event.altKey &&
    event[KEYS.CTRL_OR_CMD] &&
    ((event.shiftKey && event.key.toLowerCase() === KEYS.P) ||
      event.key === KEYS.SLASH)
  );
};

type CommandPaletteProps = {
  customCommandPaletteItems?: CommandPaletteItem[];
};

export const CommandPalette = Object.assign(
  (props: CommandPaletteProps) => {
    const uiAppState = useUIAppState();
    const setAppState = useExcalidrawSetAppState();

    useEffect(() => {
      const commandPaletteShortcut = (event: KeyboardEvent) => {
        if (isCommandPaletteToggleShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          setAppState((appState) => {
            const nextState =
              appState.openDialog?.name === "commandPalette"
                ? null
                : ({ name: "commandPalette" } as const);

            if (nextState) {
              trackEvent("command_palette", "open", "shortcut");
            }

            return {
              openDialog: nextState,
            };
          });
        }
      };
      window.addEventListener(EVENT.KEYDOWN, commandPaletteShortcut, {
        capture: true,
      });
      return () =>
        window.removeEventListener(EVENT.KEYDOWN, commandPaletteShortcut, {
          capture: true,
        });
    }, [setAppState]);

    if (uiAppState.openDialog?.name !== "commandPalette") {
      return null;
    }

    return <CommandPaletteInner {...props} />;
  },
  {
    defaultItems,
  },
);

function CommandPaletteInner({
  customCommandPaletteItems,
}: CommandPaletteProps) {
  const app = useApp();
  const uiAppState = useUIAppState();
  const setAppState = useExcalidrawSetAppState();
  const appProps = useAppProps();
  const actionManager = useExcalidrawActionManager();

  const [lastUsed, setLastUsed] = useAtom(lastUsedPaletteItem);
  const [allCommands, setAllCommands] = useState<
    MarkRequired<CommandPaletteItem, "haystack" | "order">[] | null
  >(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const stableDeps = useStable({
    uiAppState,
    customCommandPaletteItems,
    appProps,
  });

  const [libraryItemsData] = useAtom(libraryItemsAtom);
  const libraryCommands: CommandPaletteItem[] = useMemo(() => {
    return (
      libraryItemsData.libraryItems
        ?.filter(
          (libraryItem): libraryItem is MarkRequired<LibraryItem, "name"> =>
            !!libraryItem.name,
        )
        .map((libraryItem) => ({
          label: libraryItem.name,
          icon: (
            <LibraryItemIcon
              id={libraryItem.id}
              elements={libraryItem.elements}
            />
          ),
          category: "Library",
          order: getCategoryOrder("Library"),
          haystack: deburr(libraryItem.name),
          perform: () => {
            app.onInsertElements(
              distributeLibraryItemsOnSquareGrid([libraryItem]),
            );
          },
        })) || []
    );
  }, [app, libraryItemsData.libraryItems]);

  useEffect(() => {
    // these props change often and we don't want them to re-run the effect
    // which would renew `allCommands`, cascading down and resetting state.
    //
    // This means that the commands won't update on appState/appProps changes
    // while the command palette is open
    const { uiAppState, customCommandPaletteItems, appProps } = stableDeps;

    if (uiAppState && app.scene && actionManager) {
      const allCommands = [
        ...getCommandPaletteItems({
          app,
          actionManager,
          uiAppState,
          appProps,
          setAppState,
        }),
        ...(customCommandPaletteItems || []).map(withPaletteDefaults),
      ];

      setAllCommands(allCommands);
      setLastUsed(
        [...allCommands, ...libraryCommands].find(
          (command) => command.label === lastUsed?.label,
        ) ?? null,
      );
    }
  }, [
    stableDeps,
    app,
    actionManager,
    setAllCommands,
    lastUsed?.label,
    setLastUsed,
    setAppState,
    libraryCommands,
  ]);

  const [commandSearch, setCommandSearch] = useState("");
  const [currentCommand, setCurrentCommand] =
    useState<CommandPaletteItem | null>(null);
  const [commandsByCategory, setCommandsByCategory] = useState<
    Record<string, CommandPaletteItem[]>
  >({});

  const closeCommandPalette = (cb?: () => void) => {
    setAppState(
      {
        openDialog: null,
      },
      cb,
    );
    setCommandSearch("");
  };

  const executeCommand = (
    command: CommandPaletteItem,
    event: React.MouseEvent | React.KeyboardEvent | KeyboardEvent,
  ) => {
    if (uiAppState.openDialog?.name === "commandPalette") {
      event.stopPropagation();
      event.preventDefault();
      document.body.classList.add("excalidraw-animations-disabled");
      closeCommandPalette(() => {
        command.perform({ actionManager, event });
        setLastUsed(command);

        requestAnimationFrame(() => {
          document.body.classList.remove("excalidraw-animations-disabled");
        });
      });
    }
  };

  const isCommandAvailable = useStableCallback((command: CommandPaletteItem) =>
    isCommandPaletteItemAvailable(command, {
      app,
      appState: uiAppState,
      appProps,
    }),
  );

  const handleKeyDown = useStableCallback((event: KeyboardEvent) => {
    const ignoreAlphanumerics =
      isWritableElement(event.target) ||
      isCommandPaletteToggleShortcut(event) ||
      event.key === KEYS.ESCAPE;

    if (
      ignoreAlphanumerics &&
      event.key !== KEYS.ARROW_UP &&
      event.key !== KEYS.ARROW_DOWN &&
      event.key !== KEYS.ENTER
    ) {
      return;
    }

    const matchingCommands = Object.values(commandsByCategory).flat();
    const shouldConsiderLastUsed =
      lastUsed && !commandSearch && isCommandAvailable(lastUsed);

    if (event.key === KEYS.ARROW_UP) {
      event.preventDefault();
      const index = matchingCommands.findIndex(
        (item) => item.label === currentCommand?.label,
      );

      if (shouldConsiderLastUsed) {
        if (index === 0) {
          setCurrentCommand(lastUsed);
          return;
        }

        if (currentCommand === lastUsed) {
          const nextItem = matchingCommands[matchingCommands.length - 1];
          if (nextItem) {
            setCurrentCommand(nextItem);
          }
          return;
        }
      }

      let nextIndex;

      if (index === -1) {
        nextIndex = matchingCommands.length - 1;
      } else {
        nextIndex =
          index === 0
            ? matchingCommands.length - 1
            : (index - 1) % matchingCommands.length;
      }

      const nextItem = matchingCommands[nextIndex];
      if (nextItem) {
        setCurrentCommand(nextItem);
      }

      return;
    }

    if (event.key === KEYS.ARROW_DOWN) {
      event.preventDefault();
      const index = matchingCommands.findIndex(
        (item) => item.label === currentCommand?.label,
      );

      if (shouldConsiderLastUsed) {
        if (!currentCommand || index === matchingCommands.length - 1) {
          setCurrentCommand(lastUsed);
          return;
        }

        if (currentCommand === lastUsed) {
          const nextItem = matchingCommands[0];
          if (nextItem) {
            setCurrentCommand(nextItem);
          }
          return;
        }
      }

      const nextIndex = (index + 1) % matchingCommands.length;
      const nextItem = matchingCommands[nextIndex];
      if (nextItem) {
        setCurrentCommand(nextItem);
      }

      return;
    }

    if (event.key === KEYS.ENTER) {
      if (currentCommand) {
        setTimeout(() => {
          executeCommand(currentCommand, event);
        });
      }
    }

    if (ignoreAlphanumerics) {
      return;
    }

    // prevent regular editor shortcuts
    event.stopPropagation();

    // if alphanumeric keypress and we're not inside the input, focus it
    if (/^[a-zA-Z0-9]$/.test(event.key)) {
      inputRef?.current?.focus();
      return;
    }

    event.preventDefault();
  });

  useEffect(() => {
    window.addEventListener(EVENT.KEYDOWN, handleKeyDown, {
      capture: true,
    });
    return () =>
      window.removeEventListener(EVENT.KEYDOWN, handleKeyDown, {
        capture: true,
      });
  }, [handleKeyDown]);

  useEffect(() => {
    if (!allCommands) {
      return;
    }

    const getNextCommandsByCategory = (commands: CommandPaletteItem[]) => {
      const nextCommandsByCategory: Record<string, CommandPaletteItem[]> = {};
      for (const command of commands) {
        if (nextCommandsByCategory[command.category]) {
          nextCommandsByCategory[command.category].push(command);
        } else {
          nextCommandsByCategory[command.category] = [command];
        }
      }

      return nextCommandsByCategory;
    };

    let matchingCommands =
      commandSearch?.length > 1
        ? [
            ...allCommands
              .filter(isCommandAvailable)
              .sort((a, b) => a.order - b.order),
            ...libraryCommands,
          ]
        : allCommands
            .filter(isCommandAvailable)
            .sort((a, b) => a.order - b.order);

    const showLastUsed =
      !commandSearch && lastUsed && isCommandAvailable(lastUsed);

    if (!commandSearch) {
      setCommandsByCategory(
        getNextCommandsByCategory(
          showLastUsed
            ? matchingCommands.filter(
                (command) => command.label !== lastUsed?.label,
              )
            : matchingCommands,
        ),
      );
      setCurrentCommand(showLastUsed ? lastUsed : matchingCommands[0] || null);
      return;
    }

    const _query = deburr(
      commandSearch.toLocaleLowerCase().replace(/[<>_| -]/g, ""),
    );
    matchingCommands = fuzzy
      .filter(_query, matchingCommands, {
        extract: (command) => command.haystack ?? "",
      })
      .sort((a, b) => b.score - a.score)
      .map((item) => item.original);

    setCommandsByCategory(getNextCommandsByCategory(matchingCommands));
    setCurrentCommand(matchingCommands[0] ?? null);
  }, [
    commandSearch,
    allCommands,
    isCommandAvailable,
    lastUsed,
    libraryCommands,
  ]);

  return (
    <Dialog
      onCloseRequest={() => closeCommandPalette()}
      closeOnClickOutside
      title={false}
      size={720}
      autofocus
      className="command-palette-dialog"
    >
      <TextField
        value={commandSearch}
        placeholder={t("commandPalette.search.placeholder")}
        onChange={(value) => {
          setCommandSearch(value);
        }}
        selectOnRender
        ref={inputRef}
      />

      {app.editorInterface.formFactor !== "phone" && (
        <div className="shortcuts-wrapper">
          <CommandShortcutHint shortcut="↑↓">
            {t("commandPalette.shortcuts.select")}
          </CommandShortcutHint>
          <CommandShortcutHint shortcut="↵">
            {t("commandPalette.shortcuts.confirm")}
          </CommandShortcutHint>
          <CommandShortcutHint shortcut={getShortcutKey("Esc")}>
            {t("commandPalette.shortcuts.close")}
          </CommandShortcutHint>
        </div>
      )}

      <div className="commands">
        {lastUsed && !commandSearch && (
          <div className="command-category">
            <div className="command-category-title">
              {t("commandPalette.recents")}
              <div
                className="icon"
                style={{
                  marginLeft: "6px",
                }}
              >
                {historyCommandIcon}
              </div>
            </div>
            <CommandItem
              command={lastUsed}
              isSelected={lastUsed.label === currentCommand?.label}
              onClick={(event) => executeCommand(lastUsed, event)}
              disabled={!isCommandAvailable(lastUsed)}
              onMouseMove={() => setCurrentCommand(lastUsed)}
              showShortcut={app.editorInterface.formFactor !== "phone"}
              appState={uiAppState}
            />
          </div>
        )}

        {Object.keys(commandsByCategory).length > 0 ? (
          Object.keys(commandsByCategory).map((category, idx) => {
            return (
              <div className="command-category" key={category}>
                <div className="command-category-title">{category}</div>
                {commandsByCategory[category].map((command) => (
                  <CommandItem
                    key={command.label}
                    command={command}
                    isSelected={command.label === currentCommand?.label}
                    onClick={(event) => executeCommand(command, event)}
                    onMouseMove={() => setCurrentCommand(command)}
                    showShortcut={app.editorInterface.formFactor !== "phone"}
                    appState={uiAppState}
                    size={category === "Library" ? "large" : "small"}
                  />
                ))}
              </div>
            );
          })
        ) : allCommands ? (
          <div className="no-match">
            <div className="icon">{searchIcon}</div>{" "}
            {t("commandPalette.search.noMatch")}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
const LibraryItemIcon = ({
  id,
  elements,
}: {
  id: LibraryItem["id"] | null;
  elements: LibraryItem["elements"] | undefined;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const { svgCache } = useLibraryCache();
  const { theme } = useUIAppState();

  useLibraryItemSvg(id, elements, svgCache, ref, theme);

  return <div className="library-item-icon" ref={ref} />;
};

const CommandItem = ({
  command,
  isSelected,
  disabled,
  onMouseMove,
  onClick,
  showShortcut,
  appState,
  size = "small",
}: {
  command: CommandPaletteItem;
  isSelected: boolean;
  disabled?: boolean;
  onMouseMove: () => void;
  onClick: (event: React.MouseEvent) => void;
  showShortcut: boolean;
  appState: UIAppState;
  size?: "small" | "large";
}) => {
  const noop = () => {};

  return (
    <div
      className={clsx("command-item", {
        "item-selected": isSelected,
        "item-disabled": disabled,
        "command-item-large": size === "large",
      })}
      ref={(ref) => {
        if (isSelected && !disabled) {
          ref?.scrollIntoView?.({
            block: "nearest",
          });
        }
      }}
      onClick={disabled ? noop : onClick}
      onMouseMove={disabled ? noop : onMouseMove}
      title={disabled ? t("commandPalette.itemNotAvailable") : ""}
    >
      <div className="name">
        {command.icon && (
          <InlineIcon
            className="icon"
            size="var(--icon-size, 1rem)"
            icon={
              typeof command.icon === "function"
                ? command.icon(appState, [])
                : command.icon
            }
          />
        )}
        <Ellipsify>{command.label}</Ellipsify>
      </div>
      {showShortcut && command.shortcut && (
        <CommandShortcutHint shortcut={command.shortcut} />
      )}
    </div>
  );
};
