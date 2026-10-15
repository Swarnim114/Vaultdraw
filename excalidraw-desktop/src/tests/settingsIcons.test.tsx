/**
 * Every Settings page shows an icon next to its label, and each page has its
 * own icon (no label without an icon, no two pages sharing one).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SETTINGS_PAGES } from "../components/settings/schema";
import { PAGE_ICONS, Sidebar } from "../components/settings/Sidebar";

describe("settings sidebar icons", () => {
  it("has an icon for every settings page id", () => {
    for (const page of SETTINGS_PAGES) {
      expect(PAGE_ICONS[page.id], page.id).toBeTruthy();
    }
  });

  it("renders one distinct, decorative 14px icon per tab", () => {
    render(
      <Sidebar
        pages={SETTINGS_PAGES}
        activePage="general"
        onSelectPage={() => {}}
        query=""
        onQueryChange={() => {}}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(SETTINGS_PAGES.length);
    const markup = new Set<string>();
    for (const tab of tabs) {
      const svg = tab.querySelector("svg");
      expect(svg, tab.textContent ?? "").not.toBeNull();
      expect(svg!.getAttribute("width")).toBe("14");
      expect(svg!.getAttribute("height")).toBe("14");
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      markup.add(svg!.innerHTML);
    }
    expect(markup.size).toBe(tabs.length);
  });
});
