/**
 * History UI entry points: the header button, a drawing row's "History" and
 * the useHistoryEntry glue that dispatches history.toggle.
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryButton } from "../components/HistoryButton";
import { VaultHeader } from "../components/VaultHeader";
import { VaultNavigator } from "../components/VaultNavigator";
import { setHotkeyOverride } from "../commands/useCommands";
import { HISTORY_COMMAND_IDS } from "../history/historyCommands";
import { publishHistoryPanelOpen } from "../history/historyPanelState";
import { useHistoryEntry } from "../history/useHistoryEntry";

import type { ComponentProps } from "react";

import type { VaultEntry, VaultInfo } from "../vault/types";

afterEach(() => {
  window.localStorage.clear();
  publishHistoryPanelOpen(false);
});

const vault: VaultInfo = {
  handle: "h",
  name: "H",
  path: "/tmp/H",
  readOnly: false,
};
const drawing: VaultEntry = {
  path: "a.excalidraw",
  name: "a",
  kind: "drawing",
  modifiedAt: 1,
  size: 1,
};
const folder: VaultEntry = { ...drawing, path: "F", name: "F", kind: "folder" };

const headerProps = (
  over: Partial<ComponentProps<typeof VaultHeader>> = {},
): ComponentProps<typeof VaultHeader> => ({
  vault,
  activePath: "a.excalidraw",
  saveStatus: "saved",
  navigatorCollapsed: false,
  onToggleNavigator: vi.fn(),
  onOpenConflict: vi.fn(),
  onOpenRecovery: vi.fn(),
  ...over,
});

describe("HistoryButton", () => {
  it("names the command and its current key, following a rebind", () => {
    const onClick = vi.fn();
    render(<HistoryButton onClick={onClick} />);
    const button = screen.getByRole("button", { name: "History" });
    expect(button.title).toMatch(
      /^History \((Cmd\+Shift\+H|Ctrl\+Shift\+H)\)$/,
    );
    act(() => setHotkeyOverride(HISTORY_COMMAND_IDS.toggle, ["Mod+Alt+Y"]));
    expect(button.title).toMatch(/^History \((Cmd\+Option\+Y|Ctrl\+Alt\+Y)\)$/);
    act(() => setHotkeyOverride(HISTORY_COMMAND_IDS.toggle, []));
    expect(button.title).toBe("History");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is pressed while the panel is showing", () => {
    render(<HistoryButton onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "History" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    act(() => publishHistoryPanelOpen(true));
    expect(button).toHaveAttribute("aria-pressed", "true");
    act(() => publishHistoryPanelOpen(false));
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});

describe("VaultHeader history button", () => {
  it("shows only while a drawing is open, and leaves the recovery badge alone", () => {
    const onToggleHistory = vi.fn();
    const { rerender } = render(
      <VaultHeader {...headerProps({ onToggleHistory, recoveryCount: 2 })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onToggleHistory).toHaveBeenCalledOnce();
    expect(screen.getByText("2 Recovery Snapshots")).toBeInTheDocument();
    rerender(
      <VaultHeader
        {...headerProps({
          onToggleHistory,
          activePath: null,
          recoveryCount: 2,
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    expect(screen.getByText("2 Recovery Snapshots")).toBeInTheDocument();
  });
});

describe("VaultNavigator History row item", () => {
  const navProps = (
    over: Partial<ComponentProps<typeof VaultNavigator>> = {},
  ): ComponentProps<typeof VaultNavigator> => ({
    vault,
    activePath: null,
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onOpenDrawing: vi.fn(),
    onCreateDrawing: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameEntry: vi.fn(),
    onMoveEntry: vi.fn(),
    onDuplicateDrawing: vi.fn(),
    onTrashEntry: vi.fn(),
    onRevealEntry: vi.fn(),
    onSwitchVault: vi.fn(),
    treeNodes: [
      { entry: folder, children: [] } as never,
      { entry: drawing, children: [] } as never,
    ],
    expandedFolders: new Set(),
    onToggleFolder: vi.fn(),
    onExpandFolder: vi.fn(),
    allIndexedEntries: [drawing],
    sortOrder: "name_asc",
    onSortChange: vi.fn(),
    confirmDelete: true,
    ...over,
  });

  it("is offered on drawing rows, not folders", () => {
    const onShowHistory = vi.fn();
    render(<VaultNavigator {...navProps({ onShowHistory })} />);
    fireEvent.contextMenu(screen.getByText("F"));
    expect(screen.queryByRole("menuitem", { name: "History" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(screen.getByText("a"));
    fireEvent.click(screen.getByRole("menuitem", { name: "History" }));
    expect(onShowHistory).toHaveBeenCalledWith("a.excalidraw");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("useHistoryEntry", () => {
  const setup = (activePath: string | null, openOk = true) => {
    const run = vi.fn(() => true);
    const openDrawing = vi.fn(async () => openOk);
    const hook = renderHook(
      ({ path }) => useHistoryEntry(path, openDrawing, run),
      { initialProps: { path: activePath } },
    );
    return { run, openDrawing, hook };
  };

  it("toggleHistory runs history.toggle", () => {
    const { run, hook } = setup("a.excalidraw");
    hook.result.current.toggleHistory();
    expect(run).toHaveBeenCalledWith(HISTORY_COMMAND_IDS.toggle);
  });

  it("showHistory on the active drawing toggles only a closed panel", async () => {
    const { run, openDrawing, hook } = setup("a.excalidraw");
    await act(() => hook.result.current.showHistory("a.excalidraw"));
    expect(openDrawing).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledExactlyOnceWith(HISTORY_COMMAND_IDS.toggle);
    publishHistoryPanelOpen(true);
    await act(() => hook.result.current.showHistory("a.excalidraw"));
    expect(run).toHaveBeenCalledOnce();
  });

  it("showHistory on another drawing opens it first", async () => {
    const { run, openDrawing, hook } = setup("a.excalidraw");
    await act(() => hook.result.current.showHistory("b.excalidraw"));
    expect(openDrawing).toHaveBeenCalledWith("b.excalidraw");
    expect(run).not.toHaveBeenCalled();
    hook.rerender({ path: "b.excalidraw" });
    expect(run).toHaveBeenCalledExactlyOnceWith(HISTORY_COMMAND_IDS.toggle);
  });

  it("drops the request when the open fails", async () => {
    const { run, hook } = setup("a.excalidraw", false);
    await act(() => hook.result.current.showHistory("b.excalidraw"));
    hook.rerender({ path: "b.excalidraw" });
    expect(run).not.toHaveBeenCalled();
  });
});
