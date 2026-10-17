/** history.deleteAll / history.deleteCheckpoint: binding, confirm, repository call, refresh. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { HistoryHost } from "../history/HistoryHost";
import HistoryPanel from "../history/panel/HistoryPanel";
import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

vi.mock("../history/preview/VersionPreview", () => ({
  default: () => <div data-testid="mock-preview" />,
}));

const H = "fake-handle-1";
const P = "Sketches/plan.excalidraw";
const SETTINGS = toHistorySettings(HISTORY_DEFAULTS);
const SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
});

let repo: FakeHistoryRepository;
let autoId: string;
let checkpointId: string;

beforeEach(async () => {
  repo = new FakeHistoryRepository(H);
  await repo.configure(H, SETTINGS);
  autoId = repo.inject(P, SCENE, { reason: "auto" }).id;
  checkpointId = repo.inject(P, SCENE, {
    reason: "checkpoint",
    name: "Draft",
  }).id;
});
afterEach(() => cleanup());

const rowOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-version-id="${id}"]`);
const confirmButton = (name: string) =>
  within(screen.getByRole("dialog")).getByRole("button", { name });

describe("history.deleteAll (app level)", () => {
  const host = async (
    props: { readOnly?: boolean; path?: string | null } = {},
  ) => {
    const path = props.path === undefined ? P : props.path;
    await act(async () => {
      render(
        <HistoryHost
          repository={repo}
          vault={{ handle: H, readOnly: props.readOnly ?? false }}
          settings={SETTINGS}
          document={
            path ? { id: `${H}:1:${path}`, path, revision: "r1" } : null
          }
          flush={async () => {}}
          ownerDocument={document}
        />,
      );
    });
  };

  it("is bound with a writable open drawing only", async () => {
    await host();
    expect(getRegisteredHandler("history.deleteAll")).toBeDefined();
    cleanup();
    await host({ readOnly: true });
    expect(getRegisteredHandler("history.deleteAll")).toBeUndefined();
    cleanup();
    await host({ path: null });
    expect(getRegisteredHandler("history.deleteAll")).toBeUndefined();
  });

  it("asks with the drawing's name, and cancel changes nothing", async () => {
    await host();
    act(() => void getRegisteredHandler("history.deleteAll")!());
    expect(
      screen.getByText(
        "Delete all history of plan? This removes every version and checkpoint of this drawing on all synced devices.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(confirmButton("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(repo.calls).not.toContain("deleteAll");
    expect(repo.allVersions(P)).toHaveLength(2);
  });

  it("confirm deletes the history and shows a toast", async () => {
    await host();
    act(() => void getRegisteredHandler("history.deleteAll")!());
    await act(async () => {
      fireEvent.click(confirmButton("Delete all history"));
    });
    expect(repo.calls).toContain("deleteAll");
    expect(repo.allVersions(P)).toHaveLength(0);
    expect(
      await screen.findByText("Deleted all history of plan"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports a failure instead of throwing", async () => {
    vi.spyOn(repo, "deleteAll").mockRejectedValue(new Error("history is off"));
    await host();
    act(() => void getRegisteredHandler("history.deleteAll")!());
    await act(async () => {
      fireEvent.click(confirmButton("Delete all history"));
    });
    expect(await screen.findByText("history is off")).toBeInTheDocument();
  });

  it("an open panel refreshes to an empty list", async () => {
    await host();
    act(() => void getRegisteredHandler("history.toggle")!());
    await screen.findAllByRole("listitem");
    act(() => void getRegisteredHandler("history.deleteAll")!());
    await act(async () => {
      fireEvent.click(confirmButton("Delete all history"));
    });
    await waitFor(() =>
      expect(screen.queryAllByRole("listitem")).toHaveLength(0),
    );
    expect(screen.getByText("No versions yet")).toBeInTheDocument();
  });
});

describe("history.deleteCheckpoint (panel level)", () => {
  const panel = async (readOnly = false) => {
    await act(async () => {
      render(
        <HistoryPanel
          repository={repo}
          handle={H}
          path={P}
          readOnly={readOnly}
          notify={notify}
          onClose={() => {}}
        />,
      );
    });
    await screen.findAllByRole("listitem");
  };
  const notify = vi.fn();
  beforeEach(() => notify.mockClear());

  const select = async (id: string) => {
    await act(async () => {
      fireEvent.click(rowOf(id)!);
    });
  };

  it("is unbound until a checkpoint is selected", async () => {
    await panel();
    expect(getRegisteredHandler("history.deleteCheckpoint")).toBeUndefined();
    await select(autoId);
    expect(getRegisteredHandler("history.deleteCheckpoint")).toBeUndefined();
    await select(checkpointId);
    expect(getRegisteredHandler("history.deleteCheckpoint")).toBeDefined();
  });

  it("is unbound again after the panel closes and in read-only vaults", async () => {
    await panel();
    await select(checkpointId);
    cleanup();
    expect(getRegisteredHandler("history.deleteCheckpoint")).toBeUndefined();
    await panel(true);
    await select(checkpointId);
    expect(getRegisteredHandler("history.deleteCheckpoint")).toBeUndefined();
  });

  it("confirm deletes the selected checkpoint and the list refreshes", async () => {
    await panel();
    await select(checkpointId);
    act(() => void getRegisteredHandler("history.deleteCheckpoint")!());
    expect(
      within(screen.getByRole("dialog")).getByText(
        /Delete Checkpoint: Draft\?/,
      ),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(confirmButton("Delete checkpoint"));
    });
    expect(repo.calls).toContain("deleteCheckpoint");
    await waitFor(() => expect(rowOf(checkpointId)).toBeNull());
    expect(rowOf(autoId)).not.toBeNull();
    expect(notify).toHaveBeenCalledWith("Checkpoint deleted");
    expect(getRegisteredHandler("history.deleteCheckpoint")).toBeUndefined();
  });

  it("cancel (button or Escape) deletes nothing and keeps the panel open", async () => {
    await panel();
    await select(checkpointId);
    act(() => void getRegisteredHandler("history.deleteCheckpoint")!());
    fireEvent.click(confirmButton("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(repo.calls).not.toContain("deleteCheckpoint");

    act(() => void getRegisteredHandler("history.deleteCheckpoint")!());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(repo.calls).not.toContain("deleteCheckpoint");
    expect(screen.getByLabelText("History")).toBeInTheDocument();
  });

  it("only checkpoint rows have a Delete button, reachable by keyboard", async () => {
    await panel();
    expect(
      within(rowOf(autoId)!).queryByRole("button", { name: /Delete/ }),
    ).toBeNull();
    const button = within(rowOf(checkpointId)!).getByRole("button", {
      name: "Delete Checkpoint: Draft",
    });
    expect(button).not.toHaveAttribute("tabindex", "-1");
    // Pressing it neither selects the row nor restores.
    fireEvent.click(button);
    expect(rowOf(checkpointId)).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(confirmButton("Delete checkpoint"));
    });
    await waitFor(() => expect(rowOf(checkpointId)).toBeNull());
  });

  it("the row button's Enter key does not reach the list (no restore dialog)", async () => {
    await panel();
    const button = within(rowOf(checkpointId)!).getByRole("button", {
      name: /Delete/,
    });
    const notPrevented = fireEvent.keyDown(button, { key: "Enter" });
    expect(notPrevented).toBe(true);
  });

  it("read-only vaults show no Delete buttons", async () => {
    await panel(true);
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("a failed delete is reported and the list stays", async () => {
    vi.spyOn(repo, "deleteCheckpoint").mockRejectedValue(new Error("busy"));
    await panel();
    await select(checkpointId);
    act(() => void getRegisteredHandler("history.deleteCheckpoint")!());
    await act(async () => {
      fireEvent.click(confirmButton("Delete checkpoint"));
    });
    expect(notify).toHaveBeenCalledWith("busy", { error: true });
    expect(rowOf(checkpointId)).not.toBeNull();
  });
});
