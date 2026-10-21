/**
 * Tabs (F5): the tab strip (PLAN.md §3). Subscribes to the tab store only, so
 * canvas edits and view changes never re-render it. WAI-ARIA tabs pattern with
 * manual activation (arrows move focus, Enter/Space activate).
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  IconAlert,
  IconClose,
  IconDrawing,
  IconPlus,
} from "../components/Icons";

import { tabLabels } from "./tabLabels";
import { useActiveTab, useTabList } from "./tabStore";

import "./TabStrip.css";

import type { KeyboardEvent, MouseEvent } from "react";
import type { TabStore } from "./tabStore";
import type { TabId } from "./types";

export type TabStripStatus = "saved" | "dirty" | "conflict" | "error";

export interface TabStripProps {
  store: TabStore;
  onActivate: (id: TabId) => void;
  onClose: (id: TabId) => void;
  onNewTab: () => void;
  /** Save state of the active tab (background tabs are always saved). */
  activeStatus?: TabStripStatus;
}

const IconPin = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z" />
  </svg>
);

/** Keep focus on the canvas: tabs and their buttons never take mouse focus. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

export const TabStrip = memo(
  ({
    store,
    onActivate,
    onClose,
    onNewTab,
    activeStatus = "saved",
  }: TabStripProps) => {
    const tabs = useTabList(store);
    const active = useActiveTab(store);
    const labels = tabLabels(tabs);
    const listRef = useRef<HTMLDivElement>(null);
    const pendingFocus = useRef<TabId | null>(null);
    // Roving tabindex: focus position is only valid for the active tab it was set under.
    const [roving, setRoving] = useState<{
      forActive: TabId;
      id: TabId;
    } | null>(null);
    const tabStop =
      roving &&
      roving.forActive === active.id &&
      tabs.some((t) => t.id === roving.id)
        ? roving.id
        : active.id;

    const tabElement = (id: TabId): HTMLElement | null =>
      listRef.current?.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(id)}"]`,
      ) ?? null;

    useLayoutEffect(() => {
      const el = tabElement(active.id);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }, [active.id]);

    useEffect(() => {
      const id = pendingFocus.current;
      if (id) {
        pendingFocus.current = null;
        tabElement(id)?.focus();
      }
    }, [tabs]);

    const focusTab = (id: TabId) => {
      setRoving({ forActive: active.id, id });
      tabElement(id)?.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
      const id = el?.dataset.tabId;
      const index = tabs.findIndex((t) => t.id === id);
      if (index < 0) {
        return;
      }
      const n = tabs.length;
      const go = (to: number) => {
        e.preventDefault();
        focusTab(tabs[(to + n) % n].id);
      };
      switch (e.key) {
        case "ArrowRight":
          return go(index + 1);
        case "ArrowLeft":
          return go(index - 1);
        case "Home":
          return go(0);
        case "End":
          return go(n - 1);
        case "Enter":
        case " ":
          e.preventDefault();
          return onActivate(tabs[index].id);
        case "Delete": {
          e.preventDefault();
          const neighbor = tabs[index + 1] ?? tabs[index - 1];
          pendingFocus.current = neighbor ? neighbor.id : null;
          return onClose(tabs[index].id);
        }
      }
    };

    const onStripDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
      if (!(e.target as HTMLElement).closest('[role="tab"], button')) {
        onNewTab();
      }
    };

    const onTabAuxClick = useCallback(
      (e: MouseEvent, id: TabId) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose(id);
        }
      },
      [onClose],
    );

    return (
      <div
        className="vault-tabs"
        data-testid="vault-tabs"
        onDoubleClick={onStripDoubleClick}
      >
        <div
          className="vault-tabs__list"
          role="tablist"
          aria-label="Open drawings"
          ref={listRef}
          onKeyDown={onKeyDown}
        >
          {tabs.map((tab, i) => {
            const isActive = tab.id === active.id;
            const label = labels[i];
            const className = [
              "vault-tabs__tab",
              isActive && "vault-tabs__tab--active",
              tab.pinned && "vault-tabs__tab--pinned",
              tab.missing && "vault-tabs__tab--missing",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={tab.id}
                className={className}
                role="tab"
                aria-selected={isActive}
                aria-label={tab.pinned ? `${label} (pinned)` : undefined}
                tabIndex={tab.id === tabStop ? 0 : -1}
                title={tab.path ?? label}
                data-testid="vault-tab"
                data-tab-id={tab.id}
                data-path={tab.path ?? ""}
                data-active={isActive ? "true" : "false"}
                onMouseDown={keepFocus}
                onClick={() => onActivate(tab.id)}
                onAuxClick={(e) => onTabAuxClick(e, tab.id)}
                onFocus={() => setRoving({ forActive: active.id, id: tab.id })}
              >
                {tab.pinned ? (
                  <span className="vault-tabs__pin">
                    <IconPin />
                  </span>
                ) : (
                  <>
                    <IconDrawing
                      className="vault-tabs__icon"
                      width={13}
                      height={13}
                    />
                    <span className="vault-tabs__name">{label}</span>
                    {isActive && activeStatus === "dirty" && (
                      <span
                        className="vault-tabs__dot"
                        role="img"
                        aria-label="Unsaved changes"
                      />
                    )}
                    {isActive &&
                      (activeStatus === "conflict" ||
                        activeStatus === "error") && (
                        <span
                          className="vault-tabs__warn"
                          role="img"
                          aria-label={
                            activeStatus === "conflict"
                              ? "Save conflict"
                              : "Save failed"
                          }
                        >
                          <IconAlert />
                        </span>
                      )}
                    <button
                      type="button"
                      className="vault-tabs__close"
                      data-testid="vault-tab-close"
                      tabIndex={-1}
                      aria-label={`Close ${label}`}
                      onMouseDown={keepFocus}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(tab.id);
                      }}
                    >
                      <IconClose width={12} height={12} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="vault-tabs__new"
          data-testid="vault-tab-new"
          aria-label="New tab"
          title="New tab"
          onMouseDown={keepFocus}
          onClick={onNewTab}
        >
          <IconPlus width={14} height={14} />
        </button>
      </div>
    );
  },
);
