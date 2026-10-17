/** The one-time git notice (N2) and the panel's calm warning lines. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { HistoryHost } from "../history/HistoryHost";
import HistoryPanel from "../history/panel/HistoryPanel";
import {
  dismissGitNotice,
  isGitNoticeDismissed,
} from "../history/gitNoticeState";
import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

import type { HistoryStatus } from "../history/types";

vi.mock("../history/preview/VersionPreview", () => ({
  default: () => <div data-testid="mock-preview" />,
}));

const H = "fake-handle-1";
const P = "a.excalidraw";
const SETTINGS = toHistorySettings(HISTORY_DEFAULTS);
const NOTICE = "history-git-notice";

let repo: FakeHistoryRepository;
beforeEach(async () => {
  window.localStorage.clear();
  repo = new FakeHistoryRepository(H);
  await repo.configure(H, SETTINGS);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const panel = async (
  props: Partial<React.ComponentProps<typeof HistoryPanel>> = {},
) => {
  await act(async () => {
    render(
      <HistoryPanel
        repository={repo}
        handle={H}
        path={P}
        vaultKey="/vaults/one"
        onClose={() => {}}
        {...props}
      />,
    );
  });
};

const withStatus = (patch: Partial<HistoryStatus>) => {
  const original = repo.status.bind(repo);
  repo.status = async (h) => ({ ...(await original(h)), ...patch });
};

describe("git notice", () => {
  it("is hidden when the vault is not a git repository", async () => {
    await panel();
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  it("shows in a git vault and offers Exclude and Not now", async () => {
    repo.gitRepo = true;
    await panel();
    const notice = await screen.findByTestId(NOTICE);
    expect(notice).toHaveTextContent("git repository");
    expect(
      screen.getByRole("button", { name: "Exclude history from git" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
  });

  it("is hidden once history is excluded", async () => {
    repo.gitRepo = true;
    await repo.excludeFromGit(H);
    repo.calls.length = 0;
    await panel();
    await waitFor(() => expect(repo.calls).toContain("status"));
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  it("Exclude calls the repository, hides the notice and tells the host", async () => {
    repo.gitRepo = true;
    const notify = vi.fn();
    const onGitChange = vi.fn();
    await panel({ notify, onGitChange });
    fireEvent.click(
      await screen.findByRole("button", { name: "Exclude history from git" }),
    );
    await waitFor(() => expect(screen.queryByTestId(NOTICE)).toBeNull());
    expect(repo.calls.filter((c) => c === "excludeFromGit")).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith("History is now excluded from git");
    expect(onGitChange).toHaveBeenCalled();
  });

  it("shows an error and keeps the notice when excluding fails", async () => {
    repo.gitRepo = true;
    vi.spyOn(repo, "excludeFromGit").mockRejectedValue(new Error("no write"));
    const notify = vi.fn();
    await panel({ notify });
    fireEvent.click(
      await screen.findByRole("button", { name: "Exclude history from git" }),
    );
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("no write", { error: true }),
    );
    expect(screen.getByTestId(NOTICE)).toBeInTheDocument();
  });

  it("Not now hides it and is remembered per vault", async () => {
    repo.gitRepo = true;
    await panel();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId(NOTICE)).toBeNull();
    expect(repo.calls).not.toContain("excludeFromGit");
    expect(isGitNoticeDismissed("/vaults/one")).toBe(true);
    cleanup();

    await panel();
    await waitFor(() => expect(repo.calls).toContain("status"));
    expect(screen.queryByTestId(NOTICE)).toBeNull();
    cleanup();

    await panel({ vaultKey: "/vaults/two" });
    expect(await screen.findByTestId(NOTICE)).toBeInTheDocument();
  });

  it("works when local storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => dismissGitNotice("/v")).not.toThrow();
    repo.gitRepo = true;
    await panel();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  it("disables Exclude in a read-only vault", async () => {
    repo.gitRepo = true;
    await panel({ readOnly: true });
    expect(
      await screen.findByRole("button", { name: "Exclude history from git" }),
    ).toBeDisabled();
  });
});

describe("history.excludeFromGit command", () => {
  const host = async (readOnly = false) => {
    await act(async () => {
      render(
        <HistoryHost
          repository={repo}
          vault={{ handle: H, readOnly, path: "/vaults/one" }}
          settings={SETTINGS}
          document={{ id: `${H}:1:${P}`, path: P, revision: "r1" }}
          flush={async () => {}}
          ownerDocument={document}
        />,
      );
    });
  };

  it("is not offered outside a git vault", async () => {
    await host();
    expect(getRegisteredHandler("history.excludeFromGit")).toBeUndefined();
  });

  it("is offered in a git vault, excludes, and then disappears", async () => {
    repo.gitRepo = true;
    await host();
    await waitFor(() =>
      expect(getRegisteredHandler("history.excludeFromGit")).toBeDefined(),
    );
    await act(async () => {
      await getRegisteredHandler("history.excludeFromGit")!();
    });
    expect(repo.calls).toContain("excludeFromGit");
    expect(
      await screen.findByText("History is now excluded from git"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(getRegisteredHandler("history.excludeFromGit")).toBeUndefined(),
    );
  });

  it("is not offered once excluded or in a read-only vault", async () => {
    repo.gitRepo = true;
    await repo.excludeFromGit(H);
    await host();
    await waitFor(() => expect(repo.calls).toContain("status"));
    expect(getRegisteredHandler("history.excludeFromGit")).toBeUndefined();
    cleanup();

    const fresh = new FakeHistoryRepository(H);
    await fresh.configure(H, SETTINGS);
    fresh.gitRepo = true;
    repo = fresh;
    await host(true);
    await waitFor(() => expect(repo.calls).toContain("status"));
    expect(getRegisteredHandler("history.excludeFromGit")).toBeUndefined();
  });
});

describe("panel warnings", () => {
  it("is quiet by default", async () => {
    await panel();
    await waitFor(() => expect(repo.calls).toContain("status"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["checkpoints", /only checkpoints are left to remove/],
    ["other-devices", /versions from other devices/],
  ] as const)("shows the over-cap line for %s", async (overCap, text) => {
    withStatus({ overCap });
    await panel();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("shows the disk-low line", async () => {
    withStatus({
      lastError: { code: "HISTORY_DISK_LOW", message: "disk low" },
    });
    await panel();
    expect(await screen.findByText(/Disk space is low/)).toBeInTheDocument();
  });

  it("ignores other errors", async () => {
    withStatus({ lastError: { code: "HISTORY_OFF", message: "off" } });
    await panel();
    await waitFor(() => expect(repo.calls).toContain("status"));
    expect(screen.queryByText(/Disk space is low/)).toBeNull();
  });

  it("reads the status once on open, then only after history changes", async () => {
    await panel();
    const reads = () => repo.calls.filter((c) => c === "status").length;
    await waitFor(() => expect(reads()).toBe(1));
    await new Promise((r) => setTimeout(r, 40));
    expect(reads()).toBe(1);
    await act(async () => {
      repo.emit([P]);
    });
    await waitFor(() => expect(reads()).toBe(2));
  });
});
