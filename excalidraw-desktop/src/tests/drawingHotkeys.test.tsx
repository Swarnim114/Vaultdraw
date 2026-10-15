import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { drawingOpenCommandId } from "../commands/drawingCommands";
import { SettingsModal } from "../components/settings/SettingsModal";
import { getPreferences, updatePreferences } from "../vault/preferences";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "drawing-hotkeys-test",
  name: "Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

const ID = drawingOpenCommandId("Graphs/BFS.excalidraw");

const open = (pickDrawing?: () => Promise<string | null>) =>
  render(
    <SettingsModal
      vault={vault}
      onClose={vi.fn()}
      ownerDocument={document}
      initialPage="hotkeys"
      pickDrawing={pickDrawing}
    />,
  );

describe("Hotkeys page: Drawing shortcuts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updatePreferences({ hotkeys: {} }, window);
  });
  afterEach(() => {
    cleanup();
    updatePreferences({ hotkeys: {} }, window);
  });

  it("is hidden without pickDrawing and without bound drawings", () => {
    open();
    expect(screen.queryByTestId("drawing-shortcuts")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add drawing shortcut…" }),
    ).toBeNull();
  });

  it("lists bound drawings without the add button when pickDrawing is absent", () => {
    updatePreferences({ hotkeys: { [ID]: ["Mod+Alt+1"] } }, window);
    open();
    const section = screen.getByTestId("drawing-shortcuts");
    expect(within(section).getByText("Open drawing: BFS")).toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "Add drawing shortcut…" }),
    ).toBeNull();
  });

  it("adds a shortcut: pick, then record a key", async () => {
    open(async () => "Graphs/BFS.excalidraw");
    const section = screen.getByTestId("drawing-shortcuts");
    expect(
      within(section).getByText(/No drawing has a shortcut/),
    ).toBeVisible();
    await act(async () => {
      fireEvent.click(
        within(section).getByRole("button", { name: "Add drawing shortcut…" }),
      );
    });
    expect(getPreferences(window).hotkeys[ID]).toEqual([]);
    expect(within(section).getByText("Press a key…")).toBeInTheDocument();
    fireEvent.keyDown(window, {
      code: "Digit1",
      key: "1",
      altKey: true,
      ctrlKey: true,
      metaKey: true,
    });
    expect(getPreferences(window).hotkeys[ID]).toHaveLength(1);
    expect(within(section).queryByText(/No drawing has/)).toBeNull();
  });

  it("a cancelled picker adds nothing", async () => {
    open(async () => null);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add drawing shortcut…" }),
      );
    });
    expect(getPreferences(window).hotkeys).toEqual({});
  });

  it("removes a drawing shortcut and removes a single key", () => {
    updatePreferences(
      { hotkeys: { [ID]: ["Mod+Alt+1", "Mod+Alt+2"] } },
      window,
    );
    open();
    const section = screen.getByTestId("drawing-shortcuts");
    const keyRemove = within(section).getAllByRole("button", {
      name: /^Remove .* from Open drawing: BFS$/,
    });
    expect(keyRemove).toHaveLength(2);
    fireEvent.click(keyRemove[0]);
    expect(getPreferences(window).hotkeys[ID]).toHaveLength(1);
    fireEvent.click(
      within(section).getByRole("button", {
        name: "Remove shortcut for Open drawing: BFS",
      }),
    );
    expect(getPreferences(window).hotkeys[ID]).toBeUndefined();
  });

  it("keeps drawing commands out of the main command list", () => {
    updatePreferences({ hotkeys: { [ID]: ["Mod+Alt+1"] } }, window);
    open();
    const lists = screen.getAllByRole("list", { name: /Hotkeys|Drawing/ });
    const main = lists.find((l) => l.getAttribute("aria-label") === "Hotkeys")!;
    expect(within(main).queryByText("Open drawing: BFS")).toBeNull();
    expect(
      within(main).getByText("Links: Show link hints"),
    ).toBeInTheDocument();
  });
});
