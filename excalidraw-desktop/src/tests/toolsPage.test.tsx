/** Settings > Tools: tabs, sections, customised dots, search, alias commands. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMMANDS,
  SETTINGS_PENS_COMMAND_ID,
  settingsPageCommandId,
} from "../commands/commands";
import {
  appCommandHandlers,
  type AppCommandActions,
} from "../commands/useAppCommands";
import { searchSettings } from "../components/settings/schema";
import { SettingsModal } from "../components/settings/SettingsModal";
import { getPreferences } from "../vault/preferences";
import { disposeSettings } from "../vault/settingsSync";
import {
  attachVaultSettings,
  detachVaultSettings,
} from "../vault/vaultSettings";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "v",
  name: "V",
  path: "/v",
  readOnly: false,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  detachVaultSettings();
  disposeSettings();
  window.localStorage.clear();
});

const open = async (initialPage?: string) => {
  await attachVaultSettings(window, "v", { tauri: false });
  render(
    <SettingsModal
      vault={vault}
      onClose={() => {}}
      ownerDocument={document}
      initialPage={initialPage as never}
    />,
  );
};

const tab = (name: string) => screen.getByRole("tab", { name });
const selected = (name: string) =>
  expect(tab(name)).toHaveAttribute("aria-selected", "true");

describe("Tools page tabs", () => {
  it("lists the eight tools and starts on Rectangle", async () => {
    await open("tools");
    const tabs = within(screen.getByRole("tablist", { name: "Tools" }))
      .getAllByRole("tab")
      .map((t) => t.textContent);
    expect(tabs).toEqual([
      "Rectangle",
      "Diamond",
      "Ellipse",
      "Arrow",
      "Line",
      "Text",
      "Pen",
      "Laser",
    ]);
    selected("Rectangle");
    expect(screen.getByTestId("tool-default-rectangle")).toBeTruthy();
  });

  it("switches by click and by Arrow/Home/End keys (wrapping)", async () => {
    await open("tools");
    fireEvent.click(tab("Arrow"));
    selected("Arrow");
    fireEvent.keyDown(tab("Arrow"), { key: "ArrowRight" });
    selected("Line");
    fireEvent.keyDown(tab("Line"), { key: "ArrowLeft" });
    selected("Arrow");
    fireEvent.keyDown(tab("Arrow"), { key: "End" });
    selected("Laser");
    expect(screen.getByTestId("tools-laser")).toBeTruthy();
    fireEvent.keyDown(tab("Laser"), { key: "ArrowRight" });
    selected("Rectangle");
    fireEvent.keyDown(tab("Rectangle"), { key: "ArrowLeft" });
    selected("Laser");
    fireEvent.keyDown(tab("Laser"), { key: "Home" });
    selected("Rectangle");
    expect(document.activeElement).toBe(tab("Rectangle"));
  });

  it("opens the section named by initialPage", async () => {
    await open("tools:pen");
    selected("Pen");
    expect(screen.getByTestId("tools-pen")).toBeTruthy();
  });

  it("opens the laser and a styled tool section", async () => {
    await open("tools:laser");
    selected("Laser");
    expect(screen.getByTestId("tools-laser")).toBeTruthy();
  });

  it("opens tools:arrow", async () => {
    await open("tools:arrow");
    selected("Arrow");
    expect(screen.getByTestId("tool-default-arrow")).toBeTruthy();
  });
});

describe("customised dots, Reset and This vault", () => {
  it("marks a tool tab once its style is set; Reset clears it", async () => {
    await open("tools:arrow");
    const reset = screen.getByRole("button", { name: "Reset Arrow" });
    expect(reset).toBeDisabled();
    expect(tab("Arrow")).not.toHaveAttribute("data-customised");
    fireEvent.change(screen.getByTestId("tool-default-arrow-stroke_style"), {
      target: { value: "dotted" },
    });
    expect(tab("Arrow")).toHaveAttribute("data-customised", "true");
    expect(tab("Line")).not.toHaveAttribute("data-customised");
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(tab("Arrow")).not.toHaveAttribute("data-customised");
    expect(reset).toBeDisabled();
  });

  it("marks Pen when a pen changes and Laser when a laser value changes", async () => {
    await open("tools:pen");
    expect(tab("Pen")).not.toHaveAttribute("data-customised");
    fireEvent.click(screen.getByLabelText("Pen 1 highlighter"));
    expect(tab("Pen")).toHaveAttribute("data-customised", "true");
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(tab("Pen")).not.toHaveAttribute("data-customised");

    fireEvent.click(tab("Laser"));
    const reset = screen.getByRole("button", { name: "Reset laser" });
    expect(reset).toBeDisabled();
    const size = screen.getByLabelText("Laser size");
    fireEvent.change(size, { target: { value: "9" } });
    fireEvent.blur(size);
    expect(tab("Laser")).toHaveAttribute("data-customised", "true");
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(tab("Laser")).not.toHaveAttribute("data-customised");
    expect(reset).toBeDisabled();
  });

  it("the header This vault switch stores a vault override", async () => {
    await open("tools:arrow");
    const toggle = screen.getByLabelText("Arrow: This vault");
    expect(toggle).not.toBeChecked();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toBeChecked();
  });
});

describe("pen chips", () => {
  it("select which pen the rows edit", async () => {
    await open("tools:pen");
    const chips = within(screen.getByRole("radiogroup", { name: "Pens" }));
    const second = chips.getAllByRole("radio")[1];
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText("Pen 1 width")).toBeNull();
    const before = getPreferences(window).penPresets;
    const width = screen.getByLabelText("Pen 2 width");
    fireEvent.change(width, { target: { value: "7" } });
    fireEvent.blur(width);
    const after = getPreferences(window).penPresets;
    expect(after[1].width).toBe(7);
    expect(after[0]).toEqual(before[0]);
  });

  it("Add pen selects the new pen", async () => {
    await open("tools:pen");
    const n = getPreferences(window).penPresets.length;
    fireEvent.click(screen.getByRole("button", { name: "Add pen" }));
    expect(screen.getByLabelText(`Pen ${n + 1} width`)).toBeTruthy();
  });
});

describe("search", () => {
  it("finds pen, laser and tool rows by their keys", () => {
    const ids = (q: string) => searchSettings(q).map((s) => s.id);
    expect(ids("highlighter")).toContain("pen-presets");
    expect(ids("laser size")).toContain("laser-size");
    expect(ids("arrowhead")).toContain("tool-arrow");
    expect(ids("sloppiness")).toContain("tool-arrow");
    expect(ids("stroke_width")).toContain("tool-rectangle");
  });

  const search = (q: string) => {
    render(
      <SettingsModal
        vault={vault}
        onClose={() => {}}
        ownerDocument={document}
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search settings" }),
      {
        target: { value: q },
      },
    );
  };

  it.each([
    ["arrowhead", "Arrow"],
    ["highlighter", "Pen"],
    ["laser size", "Laser"],
  ])("the Tools heading for %s opens the %s section", (q, name) => {
    search(q);
    const group = screen.getByRole("region", { name: "Tools" });
    fireEvent.click(within(group).getByRole("button", { name: "Tools" }));
    selected(name);
  });
});

describe("alias commands", () => {
  const byId = (id: string) => COMMANDS.find((c) => c.id === id);

  it("registers both settings.page.tools and settings.page.pens", () => {
    expect(byId("settings.page.tools")?.title).toBe("Settings: Tools");
    expect(byId("settings.page.pens")?.title).toBe("Settings: Pens & laser");
    expect(SETTINGS_PENS_COMMAND_ID).toBe(settingsPageCommandId("pens"));
  });

  it("the pens alias opens the Pen section, tools opens the page", () => {
    const openSettingsPage = vi.fn();
    const handlers = appCommandHandlers({
      openSettingsPage,
    } as unknown as AppCommandActions);
    handlers["settings.page.pens"]?.();
    expect(openSettingsPage).toHaveBeenLastCalledWith("tools:pen");
    handlers["settings.page.tools"]?.();
    expect(openSettingsPage).toHaveBeenLastCalledWith("tools");
  });
});
