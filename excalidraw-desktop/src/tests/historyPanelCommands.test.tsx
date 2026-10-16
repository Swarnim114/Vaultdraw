import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import HistoryPanel from "../history/panel/HistoryPanel";
import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";

import { FakeHistoryRepository } from "./fakeHistoryRepository";

// Mounting a second Excalidraw is too heavy for jsdom; the stub exposes the
// two props the panel drives.
vi.mock("../history/preview/VersionPreview", () => ({
  default: (props: { onSelectionChange?: (n: number) => void }) => (
    <button
      type="button"
      data-testid="mock-preview"
      onClick={() => props.onSelectionChange?.(2)}
    />
  ),
}));

const H = "fake-handle-1";
const P = "a.excalidraw";
const SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
});

const IDS = [
  "history.previous",
  "history.next",
  "history.restore",
  "history.restoreReplace",
  "history.restoreCopy",
  "history.copySelection",
  "history.exportExcalidraw",
  "history.exportImage",
];
const bound = () => IDS.filter((id) => getRegisteredHandler(id));
const run = (id: string) =>
  act(async () => void (await getRegisteredHandler(id)!()));
const current = () =>
  document
    .querySelector(".vault-history-row[aria-current]")
    ?.getAttribute("data-version-id");

const mount = async () => {
  const history = new FakeHistoryRepository(H);
  await history.configure(H, toHistorySettings(HISTORY_DEFAULTS));
  const a = history.inject(P, SCENE, { reason: "auto" }).id;
  const b = history.inject(P, SCENE, { reason: "leave" }).id;
  const c = history.inject(P, SCENE, { reason: "checkpoint", name: "C" }).id;
  const view = render(
    <HistoryPanel
      repository={history}
      handle={H}
      path={P}
      onClose={() => {}}
    />,
  );
  await screen.findAllByRole("listitem");
  return { ids: { a, b, c }, ...view }; // newest first: c, b, a
};

describe("history panel commands", () => {
  it("binds handlers only while the panel is mounted", async () => {
    expect(bound()).toEqual([]);
    const { unmount } = await mount();
    expect(bound()).toEqual(["history.previous", "history.next"]);
    unmount();
    expect(bound()).toEqual([]);
  });

  it("previous walks to older versions and next back to the current drawing", async () => {
    const { ids } = await mount();
    await run("history.previous");
    expect(current()).toBe(ids.c);
    await run("history.previous");
    expect(current()).toBe(ids.b);
    await run("history.next");
    expect(current()).toBe(ids.c);
    await run("history.next");
    expect(current()).toBeUndefined();
    expect(screen.queryByTestId("history-preview")).toBeNull();
  });

  it("offers restore and export commands only with a selected version", async () => {
    await mount();
    await run("history.previous");
    expect(bound()).toEqual(IDS.filter((id) => id !== "history.copySelection"));
  });

  it("copySelection is enabled only with a selection in the preview", async () => {
    await mount();
    await run("history.previous");
    const copy = await screen.findByTestId("history-copy-selection");
    expect(copy).toBeDisabled();
    expect(getRegisteredHandler("history.copySelection")).toBeUndefined();
    fireEvent.click(await screen.findByTestId("mock-preview"));
    await waitFor(() => expect(copy).toBeEnabled());
    expect(getRegisteredHandler("history.copySelection")).toBeDefined();
  });

  it("restore opens the restore dialog", async () => {
    await mount();
    await run("history.previous");
    await run("history.restore");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
