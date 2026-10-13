import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@testing-library/react";

import { SettingsModal } from "../components/SettingsModal";
import { getEditorDefaults, getTheme } from "../vault/preferences";

import type { VaultInfo } from "../vault/types";

const mockVault: VaultInfo = {
  handle: "vault-settings-test",
  name: "My Settings Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

describe("SettingsModal component and preference persistence", () => {
  it("renders SettingsModal with all navigation tabs and default appearance view", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        ownerDocument={document}
      />,
    );

    expect(
      screen.getByRole("tab", { name: /appearance/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /drawing defaults/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /vault & storage/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /about/i })).toBeInTheDocument();
    expect(screen.getByText("Theme Mode")).toBeInTheDocument();
  });

  it("updates and persists theme preference when toggling between themes", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        ownerDocument={document}
      />,
    );

    const darkBtn = screen.getByRole("button", { name: "Dark" });
    fireEvent.click(darkBtn);

    expect(getTheme(window)).toBe("dark");
    expect(onThemeChanged).toHaveBeenCalledWith("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    const lightBtn = screen.getByRole("button", { name: "Light" });
    fireEvent.click(lightBtn);

    expect(getTheme(window)).toBe("light");
    expect(onThemeChanged).toHaveBeenCalledWith("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("navigates to Drawing Defaults tab and updates default font and stroke width", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        ownerDocument={document}
      />,
    );

    const defaultsTab = screen.getByRole("tab", { name: /drawing defaults/i });
    fireEvent.click(defaultsTab);

    expect(screen.getByText("Default Font Family")).toBeInTheDocument();
    expect(screen.getByText("Default Stroke Width")).toBeInTheDocument();

    const boldBtn = screen.getByRole("button", { name: "Bold (4px)" });
    fireEvent.click(boldBtn);

    const updated = getEditorDefaults(window);
    expect(updated.defaultStrokeWidth).toBe(4);
  });

  it("navigates to Vault & Storage and displays current vault folder", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();
    const onReveal = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        onRevealVault={onReveal}
        ownerDocument={document}
      />,
    );

    const vaultTab = screen.getByRole("tab", { name: /vault & storage/i });
    fireEvent.click(vaultTab);

    expect(screen.getByText("/Users/test/Vault")).toBeInTheDocument();
    expect(screen.getByText(/Autosave.*Interval/i)).toBeInTheDocument();

    const revealBtn = screen.getByRole("button", { name: /reveal folder/i });
    fireEvent.click(revealBtn);
    expect(onReveal).toHaveBeenCalled();
  });
});
