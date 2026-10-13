import { afterEach, describe, expect, it, vi } from "vitest";

import { act, fireEvent, render, screen } from "@testing-library/react";

import { SettingsModal } from "../components/SettingsModal";
import {
  getEditorDefaults,
  getPreferences,
  getTheme,
} from "../vault/preferences";
import {
  disposeSettings,
  initSettings,
  reloadSettings,
} from "../vault/settingsSync";

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
    expect(screen.getByText("Mode")).toBeInTheDocument();
    expect(screen.getByText("Colour Theme")).toBeInTheDocument();
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

  it("uses Excalidraw's real font ids, defaulting to Excalifont (5)", () => {
    window.localStorage.clear();
    render(
      <SettingsModal
        vault={mockVault}
        onClose={vi.fn()}
        ownerDocument={document}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /drawing defaults/i }));
    const select = screen.getByDisplayValue(/Excalifont/) as HTMLSelectElement;
    expect(select.value).toBe("5");
    const ids = Array.from(select.options).map((o) => Number(o.value));
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 8]);
    fireEvent.change(select, { target: { value: "8" } });
    expect(getEditorDefaults(window).defaultFontFamily).toBe(8);
  });

  it("hides config folder controls in browser mode", () => {
    render(
      <SettingsModal
        vault={mockVault}
        onClose={vi.fn()}
        ownerDocument={document}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /vault & storage/i }));
    expect(screen.queryByText(/open config folder/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^reload$/i })).toBeNull();
  });

  describe("with the config folder (Tauri)", () => {
    afterEach(() => {
      disposeSettings();
      window.localStorage.clear();
    });

    const setup = async () => {
      const config = {
        appearance: { mode: "light" },
        editor: { stroke_width: 2 },
      } as Record<string, Record<string, unknown>>;
      const invoke = vi.fn(async (cmd: string) => {
        if (cmd === "load_settings") {
          return {
            configDir: "/cfg",
            configPath: "/cfg/config.toml",
            statePath: "/state/state.json",
            config: JSON.parse(JSON.stringify(config)),
            configError: null,
            state: {},
          };
        }
        return undefined;
      });
      await initSettings(window, {
        tauri: true,
        invoke: invoke as any,
        listen: vi.fn(async () => () => {}) as any,
      });
      return { config, invoke };
    };

    it("shows the config path with Open config folder and Reload", async () => {
      const { invoke } = await setup();
      render(
        <SettingsModal
          vault={mockVault}
          onClose={vi.fn()}
          ownerDocument={document}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: /vault & storage/i }));
      expect(screen.getByText("/cfg/config.toml")).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: /open config folder/i }),
      );
      expect(invoke).toHaveBeenCalledWith("open_config_dir");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^reload$/i }));
      });
      expect(
        invoke.mock.calls.filter(([c]) => c === "load_settings"),
      ).toHaveLength(2);
      expect(await screen.findByRole("status")).toHaveTextContent(
        /up to date/i,
      );
    });

    it("refreshes displayed values when config.toml changes while open", async () => {
      const { config } = await setup();
      render(
        <SettingsModal
          vault={mockVault}
          onClose={vi.fn()}
          ownerDocument={document}
        />,
      );
      expect(screen.getByRole("button", { name: "Light" })).toHaveClass(
        "vault-segmented-btn--active",
      );
      config.appearance.mode = "dark";
      config.editor.stroke_width = 4;
      await act(async () => {
        await reloadSettings();
      });
      expect(getPreferences(window).theme).toBe("dark");
      expect(screen.getByRole("button", { name: "Dark" })).toHaveClass(
        "vault-segmented-btn--active",
      );
      fireEvent.click(screen.getByRole("tab", { name: /drawing defaults/i }));
      expect(screen.getByRole("button", { name: "Bold (4px)" })).toHaveClass(
        "vault-segmented-btn--active",
      );
    });
  });
});
