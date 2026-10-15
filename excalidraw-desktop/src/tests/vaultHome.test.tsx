import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HOME_ACTIONS, VaultHome } from "../components/VaultHome";
import { getCommand } from "../commands/commands";
import { updatePreferences } from "../vault/preferences";

const mount = (props: Partial<React.ComponentProps<typeof VaultHome>> = {}) => {
  const onRun = vi.fn();
  const onOpenDrawing = vi.fn();
  render(
    <VaultHome
      readOnly={false}
      recent={[]}
      onRun={onRun}
      onOpenDrawing={onOpenDrawing}
      ownerWindow={window}
      {...props}
    />,
  );
  return { onRun, onOpenDrawing };
};

afterEach(() => {
  cleanup();
  updatePreferences({ hotkeys: {} }, window);
  localStorage.clear();
});

describe("VaultHome", () => {
  it("only uses commands that exist in the registry", () => {
    for (const action of HOME_ACTIONS) {
      expect(getCommand(action.id), action.id).toBeDefined();
    }
  });

  it("shows four actions with their default shortcuts", () => {
    mount();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    const text = buttons.map((b) => b.textContent);
    expect(text[0]).toMatch(/New drawing/);
    expect(text[0]).toMatch(/N$/);
    expect(text[3]).toMatch(/Show all commands/);
    expect(text[3]).toMatch(/P$/);
  });

  it("shows a rebound shortcut and hides it when unassigned", () => {
    updatePreferences(
      { hotkeys: { "vault.newDrawing": ["Mod+Alt+J"] } },
      window,
    );
    mount();
    expect(screen.getByText(/New drawing/).closest("button")).toHaveTextContent(
      /J$/,
    );
    cleanup();
    updatePreferences({ hotkeys: { "vault.newDrawing": [] } }, window);
    mount();
    expect(
      screen
        .getByText(/New drawing/)
        .closest("button")!
        .querySelector("kbd"),
    ).toBeNull();
  });

  it("runs the command id on click; read-only hides the write actions", () => {
    const { onRun } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Go to drawing/ }));
    expect(onRun).toHaveBeenCalledWith("palette.files");
    cleanup();
    mount({ readOnly: true });
    expect(screen.queryByText(/New drawing/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("lists recent drawings and opens one", () => {
    const { onOpenDrawing } = mount({
      recent: [{ path: "a/b.excalidraw", name: "b", folder: "a" }],
    });
    fireEvent.click(screen.getByRole("button", { name: /b\s*a/ }));
    expect(onOpenDrawing).toHaveBeenCalledWith("a/b.excalidraw");
  });
});
