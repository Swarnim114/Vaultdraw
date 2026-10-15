import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { HistoryHost } from "../history/HistoryHost";
import HistoryPanel, {
  relativeTime,
  versionLabel,
} from "../history/panel/HistoryPanel";
import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

const H = "fake-handle-1";
const P = "a.excalidraw";
const SETTINGS = toHistorySettings(HISTORY_DEFAULTS);

const ready = async () => {
  const history = new FakeHistoryRepository(H);
  await history.configure(H, SETTINGS);
  return history;
};

describe("version labels", () => {
  it.each([
    [
      { reason: "checkpoint", name: "Before refactor" },
      "Checkpoint: Before refactor",
    ],
    [{ reason: "checkpoint", name: null }, "Checkpoint"],
    [{ reason: "auto", name: null }, "Automatic"],
    [{ reason: "before-clear", name: null }, "Before clear canvas"],
    [{ reason: "before-restore", name: null }, "Before restore"],
    [{ reason: "before-outside-change", name: null }, "Before outside change"],
    [{ reason: "first", name: null }, "Before first edit"],
    [{ reason: "recovered", name: null }, "Recovered"],
    [{ reason: "leave", name: null }, "On close"],
    [{ reason: "discarded-edits", name: null }, "Discarded edits"],
    [{ reason: "unknown", name: null }, "Version"],
    [{ reason: "from-the-future" as any, name: null }, "Version"],
  ] as const)("%j -> %s", (input, label) => {
    expect(versionLabel(input as any)).toBe(label);
  });

  it("formats relative times", () => {
    const now = 10_000_000_000;
    expect(relativeTime(now - 20_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(relativeTime(now - 72 * 3_600_000, now)).toBe("3 d ago");
  });
});

describe("HistoryPanel", () => {
  it("lists versions newest first with labels, device badge and the last-version line", async () => {
    const history = await ready();
    history.inject(P, "{}", { reason: "auto" });
    history.inject(P, "{}", {
      reason: "checkpoint",
      name: "Draft 1",
      note: "ready for review",
    });
    history.inject(P, "{}", {
      reason: "leave",
      ownDevice: false,
      device: "otherdev",
    });
    render(
      <HistoryPanel
        repository={history}
        handle={H}
        path={P}
        onClose={() => {}}
      />,
    );
    const rows = await screen.findAllByRole("listitem");
    expect(
      rows.map(
        (r) => r.querySelector(".vault-history-row__label")!.textContent,
      ),
    ).toEqual(["On close", "Checkpoint: Draft 1", "Automatic"]);
    expect(rows[0]).toHaveTextContent("Other device");
    expect(rows[1]).not.toHaveTextContent("Other device");
    expect(rows[1]).toHaveTextContent("ready for review");
    expect(screen.getByTestId("history-last")).toHaveTextContent(
      "Last version: just now",
    );
  });

  it("shows an empty state and a disabled state", async () => {
    const history = await ready();
    const { unmount } = render(
      <HistoryPanel
        repository={history}
        handle={H}
        path={P}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText("No versions yet")).toBeInTheDocument();
    unmount();
    await history.configure(H, { ...SETTINGS, enabled: false });
    render(
      <HistoryPanel
        repository={history}
        handle={H}
        path={P}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText("History is off")).toBeInTheDocument();
  });

  it("refreshes on a history-change for its path only", async () => {
    const history = await ready();
    render(
      <HistoryPanel
        repository={history}
        handle={H}
        path={P}
        onClose={() => {}}
      />,
    );
    await screen.findByText("No versions yet");
    const list = vi.spyOn(history, "list");
    await act(async () => {
      history.inject("other.excalidraw", "{}");
    });
    expect(list).not.toHaveBeenCalled();
    await act(async () => {
      history.inject(P, "{}", { reason: "before-clear" });
    });
    expect(await screen.findByText("Before clear canvas")).toBeInTheDocument();
  });

  it("Escape closes it", async () => {
    const history = await ready();
    const onClose = vi.fn();
    render(
      <HistoryPanel
        repository={history}
        handle={H}
        path={P}
        onClose={onClose}
      />,
    );
    await screen.findByText("No versions yet");
    fireEvent.keyDown(screen.getByRole("list", { name: "Versions" }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", async () => {
    const history = await ready();
    const { unmount } = render(
      <HistoryPanel
        repository={history}
        handle={H}
        path={P}
        onClose={() => {}}
      />,
    );
    await screen.findByText("No versions yet");
    unmount();
    const list = vi.spyOn(history, "list");
    history.inject(P, "{}");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("HistoryHost", () => {
  const mount = async (flush = vi.fn().mockResolvedValue(undefined)) => {
    const history = await ready();
    history.noteCommitted(H, P, '{"elements":[]}');
    const view = render(
      <HistoryHost
        repository={history}
        vault={{ handle: H, readOnly: false }}
        settings={SETTINGS}
        document={{ id: `${H}:1:${P}`, path: P, revision: "r1" }}
        flush={flush}
        ownerDocument={document}
      />,
    );
    return { history, flush, ...view };
  };

  it("renders nothing and loads no panel until the toggle command runs", async () => {
    await mount();
    expect(screen.queryByLabelText("History")).toBeNull();
    expect(getRegisteredHandler("history.checkpoint")).toBeDefined();
    expect(getRegisteredHandler("history.toggle")).toBeDefined();
    expect(getRegisteredHandler("history.timeTravel")).toBeDefined();
    expect(getRegisteredHandler("history.restore")).toBeUndefined();
  });

  it("toggle opens and closes the panel; time travel opens it", async () => {
    await mount();
    act(() => void getRegisteredHandler("history.toggle")!());
    expect(await screen.findByLabelText("History")).toBeInTheDocument();
    act(() => void getRegisteredHandler("history.toggle")!());
    await waitFor(() => expect(screen.queryByLabelText("History")).toBeNull());
    act(() => void getRegisteredHandler("history.timeTravel")!());
    expect(await screen.findByLabelText("History")).toBeInTheDocument();
  });

  it("checkpoint: flushes first, then saves, then confirms", async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => void order.push("flush"));
    const { history } = await mount(flush);
    const checkpoint = history.checkpoint.bind(history);
    history.checkpoint = async (...args) => {
      order.push("checkpoint");
      return checkpoint(...args);
    };
    act(() => void getRegisteredHandler("history.checkpoint")!());
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Milestone" } });
    fireEvent.submit(name.closest("form")!);
    expect(
      await screen.findByText("Checkpoint saved: Milestone"),
    ).toBeInTheDocument();
    expect(order).toEqual(["flush", "checkpoint"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await history.list(H, P)).versions[0]).toMatchObject({
      reason: "checkpoint",
      name: "Milestone",
    });
  });

  it("does not open the dialog in a read-only vault", async () => {
    const history = await ready();
    render(
      <HistoryHost
        repository={history}
        vault={{ handle: H, readOnly: true }}
        settings={SETTINGS}
        document={{ id: `${H}:1:${P}`, path: P, revision: "r1" }}
        flush={async () => {}}
        ownerDocument={document}
      />,
    );
    act(() => void getRegisteredHandler("history.checkpoint")!());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
