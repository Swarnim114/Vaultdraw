/**
 * Settings > Tools: one page for every drawing tool. A row of tool tabs
 * (like the editor's toolbar) picks the section; one section is shown at a
 * time: a styled tool's default style, the saved pens, or the laser.
 * A dot on a tab marks a tool whose settings differ from the defaults.
 */
import { useRef, type KeyboardEvent } from "react";

import {
  isStyledTool,
  TOOL_DEFAULT_TOOLS,
  toolField,
  type StyledTool,
} from "../../../toolDefaults/toolStyles";
import {
  TOOLS_SECTION_LABELS,
  TOOLS_SECTIONS,
  type ToolsSection,
} from "../schema";
import { useSettings } from "../SettingsContext";
import "../toolsPage.css";

import {
  LaserPanel,
  PenPanel,
  useLaserCustomised,
  usePensCustomised,
} from "./Pens";
import { ToolStylePanel } from "./ToolDefaults";
import { TOOL_ICONS } from "./toolsLayout";

export const DEFAULT_TOOLS_SECTION: ToolsSection = TOOL_DEFAULT_TOOLS[0];

export const toolsTabId = (section: ToolsSection) =>
  `vault-tools-tab-${section}`;
const TOOLS_PANEL_ID = "vault-tools-panel";

/** Every section's "differs from default" flag. */
const useCustomised = (): Record<ToolsSection, boolean> => {
  const { vaultSettings } = useSettings();
  const styled = Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => [
      tool,
      Object.keys(vaultSettings.effective[toolField(tool)]).length > 0,
    ]),
  ) as Record<StyledTool, boolean>;
  return { ...styled, pen: usePensCustomised(), laser: useLaserCustomised() };
};

const ToolTabs = ({
  section,
  onSelect,
}: {
  section: ToolsSection;
  onSelect: (section: ToolsSection) => void;
}) => {
  const customised = useCustomised();
  const listRef = useRef<HTMLDivElement>(null);
  const focusTab = (next: ToolsSection) => {
    onSelect(next);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${toolsTabId(next)}`)
      ?.focus();
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    const i = TOOLS_SECTIONS.indexOf(section);
    const last = TOOLS_SECTIONS.length - 1;
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % TOOLS_SECTIONS.length
        : e.key === "ArrowLeft"
        ? (i + last) % TOOLS_SECTIONS.length
        : e.key === "Home"
        ? 0
        : e.key === "End"
        ? last
        : null;
    if (next !== null) {
      e.preventDefault();
      focusTab(TOOLS_SECTIONS[next]);
    }
  };
  return (
    <div
      ref={listRef}
      className="vault-tools-tabs"
      role="tablist"
      aria-label="Tools"
      onKeyDown={handleKeyDown}
    >
      {TOOLS_SECTIONS.map((s) => {
        const active = s === section;
        const label = TOOLS_SECTION_LABELS[s];
        return (
          <button
            key={s}
            id={toolsTabId(s)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={TOOLS_PANEL_ID}
            tabIndex={active ? 0 : -1}
            className={`vault-tools-tab ${
              active ? "vault-tools-tab--active" : ""
            }`}
            title={customised[s] ? `${label} (customised)` : label}
            data-customised={customised[s] || undefined}
            onClick={() => onSelect(s)}
          >
            <span className="vault-tools-tab__icon">
              {TOOL_ICONS[s]}
              {customised[s] && (
                <span className="vault-tools-tab__dot" aria-hidden="true" />
              )}
            </span>
            <span className="vault-tools-tab__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

const Section = ({ section }: { section: ToolsSection }) =>
  section === "pen" ? (
    <PenPanel />
  ) : section === "laser" ? (
    <LaserPanel />
  ) : isStyledTool(section) ? (
    <ToolStylePanel tool={section} />
  ) : null;

export interface ToolsPageProps {
  section?: ToolsSection;
  onSectionChange: (section: ToolsSection) => void;
}

export const ToolsPage = ({
  section = DEFAULT_TOOLS_SECTION,
  onSectionChange,
}: ToolsPageProps) => (
  <div className="vault-tools-page">
    <ToolTabs section={section} onSelect={onSectionChange} />
    <p className="vault-tools-legend">
      customised · unset values keep Excalidraw&apos;s current style
    </p>
    <div
      id={TOOLS_PANEL_ID}
      role="tabpanel"
      aria-labelledby={toolsTabId(section)}
      className="vault-tools-body"
    >
      <Section section={section} />
    </div>
  </div>
);
