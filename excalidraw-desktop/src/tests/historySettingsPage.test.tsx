/** Settings > History: rows, ranges, preset, usage bar, git and delete-all. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsModal } from "../components/settings/SettingsModal";
import { formatBytes } from "../components/settings/pages/History";
import { Toasts } from "../components/Toasts";
import { SETTINGS_PAGES, settingsForPage } from "../components/settings/schema";
import { publishHistoryBridge } from "../history/historyBridge";
import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";
import { toastStore } from "../toasts/toastStore";
import { getPreferences, updatePreferences } from "../vault/preferences";
import { disposeSettings } from "../vault/settingsSync";
import {
  attachVaultSettings,
  detachVaultSettings,
} from "../vault/vaultSettings";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

import type { VaultInfo } from "../vault/types";
import type { HistoryStatus } from "../history/types";

const H = "fake-handle-1";
const P = "Sketches/plan.excalidraw";
const MB = 1024 * 1024;
const vault: VaultInfo = { handle: H, name: "V", path: "/v", readOnly: false };

let repo: FakeHistoryRepository;

beforeEach(async () => {
  toastStore.clear();
  window.localStorage.clear();
  repo = new FakeHistoryRepository(H);
  await repo.configure(H, toHistorySettings(HISTORY_DEFAULTS));
});
afterEach(() => {
  cleanup();
  publishHistoryBridge(null);
  detachVaultSettings();
  disposeSettings();
  window.localStorage.clear();
});

const open = async (opts: { path?: string | null; vault?: VaultInfo } = {}) => {
  await attachVaultSettings(window, H, { tauri: false });
  publishHistoryBridge({
    repository: repo,
    handle: H,
    path: opts.path === undefined ? P : opts.path,
    readOnly: false,
  });
  await act(async () => {
    render(
      <>
        <SettingsModal
          vault={opts.vault ?? vault}
          onClose={() => {}}
          ownerDocument={document}
          initialPage="history"
        />
        <Toasts />
      </>,
    );
  });
};

const spin = (name: string) => screen.getByRole("spinbutton", { name });
const press = (name: string, key: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    fireEvent.keyDown(spin(name), { key });
  }
};

describe("History settings page", () => {
  it("is a sidebar page with its schema rows", async () => {
    expect(SETTINGS_PAGES.some((p) => p.id === "history")).toBe(true);
    expect(settingsForPage("history").map((s) => s.id)).toContain(
      "history-size-cap",
    );
    await open();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    for (const label of [
      "Enable history",
      "Version interval (minutes)",
      "Keep every version for (hours)",
      "Then keep one per hour for (hours)",
      "Then keep one per day for (days)",
      "Then keep one per week for (weeks)",
      "Size limit (MB)",
      "Highlight changes in preview",
      "Privacy",
      "Delete all history of the open drawing",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        "History syncs with your vault, so removed content stays readable in history until it is thinned or you delete it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Time Machine defaults" }),
    ).toBeInTheDocument();
  });

  it("only reads history_status while open (no polling)", async () => {
    await open();
    await waitFor(() => expect(repo.calls).toContain("status"));
    const before = repo.calls.filter((c) => c === "status").length;
    await new Promise((r) => setTimeout(r, 50));
    expect(repo.calls.filter((c) => c === "status").length).toBe(before);
  });

  it("toggles the kill switch and highlight", async () => {
    await open();
    fireEvent.click(screen.getByRole("switch", { name: "Enable history" }));
    expect(getPreferences(window).historyEnabled).toBe(false);
    fireEvent.click(
      screen.getByRole("switch", { name: "Highlight changes in preview" }),
    );
    expect(getPreferences(window).historyHighlightChanges).toBe(false);
  });

  it("steppers move by their step with the keyboard and clamp at the limits", async () => {
    await open();
    const interval = "Version interval in minutes";
    expect(spin(interval)).toHaveAttribute("aria-valuenow", "5");
    press(interval, "ArrowUp");
    expect(getPreferences(window).historyIntervalMinutes).toBe(6);
    press(interval, "ArrowDown", 2);
    expect(getPreferences(window).historyIntervalMinutes).toBe(4);
    press(interval, "PageUp");
    expect(getPreferences(window).historyIntervalMinutes).toBe(9);
    press(interval, "Home");
    expect(getPreferences(window).historyIntervalMinutes).toBe(0);
    press(interval, "ArrowDown");
    expect(getPreferences(window).historyIntervalMinutes).toBe(0);
    press(interval, "End");
    expect(getPreferences(window).historyIntervalMinutes).toBe(1440);
    press(interval, "ArrowUp");
    expect(getPreferences(window).historyIntervalMinutes).toBe(1440);

    press("Keep every version for hours", "End");
    expect(getPreferences(window).historyKeepAllHours).toBe(720);
    press("Keep one per hour for hours", "End");
    expect(getPreferences(window).historyKeepHourlyHours).toBe(8760);
    press("Keep one per day for days", "End");
    expect(getPreferences(window).historyKeepDailyDays).toBe(3650);
    press("Keep one per week for weeks", "End");
    expect(getPreferences(window).historyKeepWeeklyWeeks).toBe(5200);
  });

  it("the size limit steps by 50 MB and Home means no limit", async () => {
    await open();
    const cap = "Size limit in megabytes";
    expect(spin(cap)).toHaveAttribute("aria-valuetext", "500 MB");
    press(cap, "ArrowUp");
    expect(getPreferences(window).historySizeCapMb).toBe(550);
    press(cap, "ArrowDown", 2);
    expect(getPreferences(window).historySizeCapMb).toBe(450);
    press(cap, "Home");
    expect(getPreferences(window).historySizeCapMb).toBe(0);
  });

  it("the Time Machine defaults button resets the four retention values", async () => {
    updatePreferences(
      {
        historyKeepAllHours: 5,
        historyKeepHourlyHours: 6,
        historyKeepDailyDays: 7,
        historyKeepWeeklyWeeks: 8,
        historySizeCapMb: 123,
      },
      window,
    );
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Time Machine defaults" }),
    );
    const prefs = getPreferences(window);
    expect(prefs.historyKeepAllHours).toBe(1);
    expect(prefs.historyKeepHourlyHours).toBe(24);
    expect(prefs.historyKeepDailyDays).toBe(30);
    expect(prefs.historyKeepWeeklyWeeks).toBe(0);
    // The size limit is not part of the preset.
    expect(prefs.historySizeCapMb).toBe(123);
    expect(
      screen.getByRole("button", { name: "Time Machine defaults" }),
    ).toBeDisabled();
  });

  it("a row's reset button restores its default", async () => {
    updatePreferences({ historyIntervalMinutes: 30 }, window);
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Version interval (minutes)" }),
    );
    expect(getPreferences(window).historyIntervalMinutes).toBe(5);
  });

  it("shows usage against the cap with the checkpoint share", async () => {
    repo.inject(P, "x", { reason: "checkpoint", sizeBytes: 5 * MB });
    repo.inject(P, "x", { reason: "auto", sizeBytes: 45 * MB });
    await open();
    const usage = await screen.findByTestId("history-usage");
    expect(usage).toHaveTextContent(
      "50.0 MB of 500.0 MB used, of which checkpoints 5.0 MB",
    );
    expect(within(usage).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
  });

  it("shows no bar without a cap", async () => {
    updatePreferences({ historySizeCapMb: 0 }, window);
    repo.inject(P, "x", { sizeBytes: 2 * MB });
    await open();
    const usage = await screen.findByTestId("history-usage");
    expect(usage).toHaveTextContent("2.0 MB used, no limit");
    expect(within(usage).queryByRole("progressbar")).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(3 * MB)).toBe("3.0 MB");
    expect(formatBytes(2.5 * 1024 * MB)).toBe("2.5 GB");
  });

  it.each([
    ["checkpoints", /only checkpoints are left/],
    ["other-devices", /versions from other devices/],
  ] as const)("explains overCap=%s calmly", async (overCap, text) => {
    const original = repo.status.bind(repo);
    repo.status = async (h) =>
      ({ ...(await original(h)), overCap } as HistoryStatus);
    await open();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("explains a blocked GC", async () => {
    const original = repo.status.bind(repo);
    repo.status = async (h) =>
      ({ ...(await original(h)), gcBlocked: true } as HistoryStatus);
    await open();
    expect(await screen.findByText(/Thinning is paused/)).toBeInTheDocument();
  });

  describe("git button", () => {
    it("is hidden for a vault that is not a git repository", async () => {
      await open();
      await waitFor(() => expect(repo.calls).toContain("status"));
      expect(
        screen.queryByRole("button", { name: /Exclude history from git/ }),
      ).toBeNull();
    });

    it("excludes once, then shows Excluded and is disabled", async () => {
      repo.gitRepo = true;
      await open();
      const button = await screen.findByRole("button", {
        name: "Exclude history from git",
      });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      const done = await screen.findByRole("button", { name: "Excluded" });
      expect(done).toBeDisabled();
      expect(repo.calls.filter((c) => c === "excludeFromGit")).toHaveLength(1);
    });
  });

  describe("delete all history of the open drawing", () => {
    it("is disabled without an open drawing", async () => {
      await open({ path: null });
      expect(
        screen.getByRole("button", { name: "Delete all history…" }),
      ).toBeDisabled();
    });

    it("asks first, and cancel changes nothing", async () => {
      repo.inject(P, "{}", { reason: "auto" });
      await open();
      fireEvent.click(
        screen.getByRole("button", { name: "Delete all history…" }),
      );
      expect(
        screen.getByText(
          "Delete all history of plan? This removes every version and checkpoint of this drawing on all synced devices.",
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: /Delete/ })).toBeNull();
      expect(repo.calls).not.toContain("deleteAll");
      expect(repo.allVersions(P)).toHaveLength(1);
    });

    it("confirm deletes the history and refreshes the usage", async () => {
      repo.inject(P, "x", { sizeBytes: 3 * MB });
      await open();
      expect(await screen.findByTestId("history-usage")).toHaveTextContent(
        "3.0 MB of",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Delete all history…" }),
      );
      await act(async () => {
        fireEvent.click(
          screen.getAllByRole("button", { name: "Delete all history" })[0],
        );
      });
      await waitFor(() => expect(repo.allVersions(P)).toHaveLength(0));
      expect(
        await screen.findByText("History of the open drawing deleted."),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByTestId("history-usage")).toHaveTextContent(
          "0 KB of",
        ),
      );
    });
  });
});
