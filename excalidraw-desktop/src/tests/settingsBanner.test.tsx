/**
 * QA regression: a config.toml problem banner used to share the transient
 * global alert, so any unrelated setGlobalAlert(null) (opening a drawing…)
 * hid it for good while the file was still broken.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VaultApp } from "../VaultApp";
import {
  disposeSettings,
  initSettings,
  reloadSettings,
} from "../vault/settingsSync";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { SAMPLE_SCENE } from "./fixtures";

const backend = () => {
  const state = {
    configError: { message: "expected `=`", line: 3 } as {
      message: string;
      line: number | null;
    } | null,
  };
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === "load_settings") {
      return {
        configDir: "/c",
        configPath: "/c/config.toml",
        statePath: "/s/state.json",
        config: state.configError ? null : {},
        configError: state.configError,
        state: {},
      };
    }
    return undefined;
  });
  const listen = vi.fn(async () => () => {});
  return { state, invoke, listen };
};

afterEach(() => disposeSettings());

const banner = () => screen.queryByTestId("settings-problem-banner");

describe("settings problem banner", () => {
  it("survives unrelated alert clears, is dismissible, and returns when the problem changes", async () => {
    const b = backend();
    await initSettings(window, {
      tauri: true,
      invoke: b.invoke as any,
      listen: b.listen as any,
    });
    const repo = new FakeVaultRepository();
    repo.seedDrawing("notes.excalidraw", SAMPLE_SCENE);
    render(<VaultApp repository={repo} initialVault={repo.vault} />);

    expect(banner()).toHaveTextContent("config.toml line 3: expected `=`");

    // Opening a drawing clears the global alert; the banner must stay.
    const tree = within(screen.getByLabelText("Vault File Navigator"));
    await waitFor(() => expect(tree.getByText("notes")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(tree.getByText("notes"));
    });
    expect(banner()).toHaveTextContent("config.toml line 3");

    // Dismiss: hidden while the text is unchanged…
    fireEvent.click(screen.getByLabelText("Dismiss settings problem"));
    expect(banner()).toBeNull();
    await act(async () => {
      await reloadSettings();
    });
    expect(banner()).toBeNull();

    // …and shown again for a different problem.
    b.state.configError = { message: "invalid table header", line: 7 };
    await act(async () => {
      await reloadSettings();
    });
    expect(banner()).toHaveTextContent("config.toml line 7");

    // Fixed: gone.
    b.state.configError = null;
    await act(async () => {
      await reloadSettings();
    });
    expect(banner()).toBeNull();
  });
});
