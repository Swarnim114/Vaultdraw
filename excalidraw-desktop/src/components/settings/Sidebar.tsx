import {
  IconClose,
  IconFolder,
  IconKeyboard,
  IconLayout,
  IconPalette,
  IconPenTool,
  IconSearch,
  IconSettings,
  IconTools,
} from "../Icons";

import type { KeyboardEvent, ReactNode, RefObject } from "react";

import type { SettingsPage, SettingsPageId } from "./schema";

const NAV_ICON = { width: 14, height: 14, "aria-hidden": true } as const;

/** One icon per page, same size and stroke, so every label lines up. */
export const PAGE_ICONS: Record<SettingsPageId, ReactNode> = {
  general: <IconSettings {...NAV_ICON} />,
  appearance: <IconPalette {...NAV_ICON} />,
  interface: <IconLayout {...NAV_ICON} />,
  drawing: <IconPenTool {...NAV_ICON} />,
  tools: <IconTools {...NAV_ICON} />,
  files: <IconFolder {...NAV_ICON} />,
  hotkeys: <IconKeyboard {...NAV_ICON} />,
};

export const settingsTabId = (page: SettingsPageId) =>
  `vault-settings-tab-${page}`;
export const SETTINGS_PANEL_ID = "vault-settings-panel";

export interface SidebarProps {
  pages: readonly SettingsPage[];
  /** null while search results are shown. */
  activePage: SettingsPageId | null;
  onSelectPage: (page: SettingsPageId) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
}

export const Sidebar = ({
  pages,
  activePage,
  onSelectPage,
  query,
  onQueryChange,
  searchRef,
}: SidebarProps) => {
  const groups: { name: string; pages: SettingsPage[] }[] = [];
  for (const page of pages) {
    const group = groups.find((g) => g.name === page.group);
    if (group) {
      group.pages.push(page);
    } else {
      groups.push({ name: page.group, pages: [page] });
    }
  }

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // First Escape clears the search; Settings closes on the next one.
    if (e.key === "Escape" && query) {
      e.preventDefault();
      onQueryChange("");
    }
  };

  return (
    <aside className="vault-settings-sidebar">
      <div className="vault-settings-search">
        <IconSearch
          className="vault-settings-search__icon"
          width="14"
          height="14"
          aria-hidden="true"
        />
        <input
          ref={searchRef}
          type="search"
          className="vault-settings-search__input"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="vault-settings-search__clear"
            aria-label="Clear settings search"
            onClick={() => {
              onQueryChange("");
              searchRef?.current?.focus();
            }}
          >
            <IconClose width="12" height="12" />
          </button>
        )}
      </div>
      {groups.map((group) => (
        <div key={group.name} className="vault-settings-nav-group">
          <div className="vault-settings-nav-group__title">{group.name}</div>
          <nav
            className="vault-settings-nav"
            role="tablist"
            aria-orientation="vertical"
            aria-label={`${group.name} settings pages`}
          >
            {group.pages.map((page) => {
              const active = page.id === activePage;
              return (
                <button
                  key={page.id}
                  id={settingsTabId(page.id)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={SETTINGS_PANEL_ID}
                  className={`vault-settings-nav-item ${
                    active ? "vault-settings-nav-item--active" : ""
                  }`}
                  onClick={() => onSelectPage(page.id)}
                >
                  {PAGE_ICONS[page.id]}
                  <span>{page.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      ))}
    </aside>
  );
};
