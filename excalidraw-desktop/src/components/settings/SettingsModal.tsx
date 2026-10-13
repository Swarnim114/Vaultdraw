import { useEffect, useRef, useState } from "react";

import { IconClose } from "../Icons";

import { SETTING_CONTROLS } from "./pages";
import {
  DEFAULT_SETTINGS_PAGE,
  getPage,
  groupByPage,
  searchSettings,
  SETTINGS_PAGES,
  SETTINGS_SCHEMA,
  settingsForPage,
  type SettingSchema,
  type SettingsPageId,
} from "./schema";
import { SettingsProvider, useSettingsController } from "./SettingsContext";
import { SETTINGS_PANEL_ID, settingsTabId, Sidebar } from "./Sidebar";

import type { ThemeRegistry } from "../../theme/registry";
import type { VaultInfo } from "../../vault/types";

export interface SettingsModalProps {
  vault: VaultInfo | null;
  onClose: () => void;
  onThemeChanged?: (resolvedTheme: "light" | "dark") => void;
  /** Colour theme, mode or canvas sync changed (re-apply the appearance). */
  onAppearanceChanged?: () => void;
  /** Built-in + user themes; defaults to the cached registry. */
  themeRegistry?: ThemeRegistry;
  onRevealVault?: (path: string) => void;
  ownerDocument?: Document | null;
  /** Page shown when Settings opens. */
  initialPage?: SettingsPageId;
}

/** Text field or editor that owns the keyboard (e.g. Excalidraw's text editor). */
const isEditable = (el: Element | null) =>
  !!el &&
  (el.tagName === "TEXTAREA" ||
    el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    (el as HTMLElement).isContentEditable);

const SettingList = ({ settings }: { settings: readonly SettingSchema[] }) => (
  <div className="vault-settings-section">
    {settings.map((s) => {
      const { Component } = SETTING_CONTROLS[s.id];
      return <Component key={s.id} />;
    })}
  </div>
);

export const SettingsModal = ({
  vault,
  onClose,
  onThemeChanged,
  onAppearanceChanged,
  themeRegistry,
  onRevealVault,
  ownerDocument,
  initialPage = DEFAULT_SETTINGS_PAGE,
}: SettingsModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const doc = ownerDocument ?? modalRef.current?.ownerDocument ?? null;
  const win =
    doc?.defaultView ?? (typeof window !== "undefined" ? window : null);

  const settings = useSettingsController({
    win,
    doc,
    vault,
    themeRegistry,
    onThemeChanged,
    onAppearanceChanged,
    onRevealVault,
  });

  const [page, setPage] = useState<SettingsPageId>(initialPage);
  const [query, setQuery] = useState("");
  const queryRef = useRef(query);
  queryRef.current = query;

  const available = SETTINGS_SCHEMA.filter((s) => {
    const control = SETTING_CONTROLS[s.id];
    return !!control && (control.available?.(settings) ?? true);
  });
  const pages = SETTINGS_PAGES.filter((p) =>
    available.some((s) => s.page === p.id),
  );
  const activePage = pages.some((p) => p.id === page)
    ? page
    : pages[0]?.id ?? DEFAULT_SETTINGS_PAGE;
  const searching = query.trim() !== "";
  const results = searching
    ? groupByPage(searchSettings(query, available))
    : [];

  const openPage = (next: SettingsPageId) => {
    setQuery("");
    setPage(next);
  };

  // Focus the search box, unless Settings opened over a text edit (e.g.
  // Cmd+, while typing on the canvas): taking focus would end that edit.
  useEffect(() => {
    const active = searchRef.current?.ownerDocument.activeElement ?? null;
    if (isEditable(active) && !modalRef.current?.contains(active)) {
      return;
    }
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape: a control that handled it (e.g. the theme search) marks it
  // handled; otherwise clear the settings search first, then close.
  useEffect(() => {
    const targetDoc =
      doc ?? (typeof document !== "undefined" ? document : null);
    if (!targetDoc) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      // Respect a handled Escape from our own controls or from a text field
      // (Excalidraw's text editor commits on Escape). Excalidraw's canvas
      // also claims Escape (deselect) but must not keep Settings open.
      const target = e.target instanceof Element ? e.target : null;
      if (
        e.defaultPrevented &&
        (isEditable(target) || !!modalRef.current?.contains(target))
      ) {
        return;
      }
      e.preventDefault();
      if (queryRef.current) {
        setQuery("");
        return;
      }
      onClose();
    };
    targetDoc.addEventListener("keydown", handleKeyDown);
    return () => targetDoc.removeEventListener("keydown", handleKeyDown);
  }, [doc, onClose]);

  return (
    <div
      className="vault-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div ref={modalRef} className="vault-settings-modal">
        <Sidebar
          pages={pages}
          activePage={searching ? null : activePage}
          onSelectPage={openPage}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
        />

        <section className="vault-settings-content">
          <div className="vault-settings-header">
            <h2 id="settings-title" className="vault-settings-title">
              {searching ? "Search results" : getPage(activePage).label}
            </h2>
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--icon"
              onClick={onClose}
              aria-label="Close Settings"
            >
              <IconClose />
            </button>
          </div>

          <SettingsProvider value={settings}>
            {searching ? (
              <div
                className="vault-settings-body vault-settings-results"
                aria-label="Settings search results"
                role="region"
              >
                {results.length === 0 ? (
                  <p className="vault-settings-empty" role="status">
                    No settings match &ldquo;{query.trim()}&rdquo;.
                  </p>
                ) : (
                  results.map((group) => (
                    <section
                      key={group.page.id}
                      className="vault-settings-result-group"
                      data-page={group.page.id}
                      aria-label={group.page.label}
                    >
                      <h3 className="vault-settings-result-group__title">
                        <button
                          type="button"
                          className="vault-settings-result-group__link"
                          onClick={() => openPage(group.page.id)}
                          title={`Open ${group.page.label}`}
                        >
                          {group.page.label}
                        </button>
                      </h3>
                      <SettingList settings={group.settings} />
                    </section>
                  ))
                )}
              </div>
            ) : (
              <div
                className="vault-settings-body"
                id={SETTINGS_PANEL_ID}
                role="tabpanel"
                aria-labelledby={settingsTabId(activePage)}
                data-page={activePage}
              >
                <SettingList
                  settings={settingsForPage(activePage, available)}
                />
              </div>
            )}
          </SettingsProvider>
        </section>
      </div>
    </div>
  );
};
