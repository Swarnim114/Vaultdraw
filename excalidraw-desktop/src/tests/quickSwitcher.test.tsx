import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickSwitcher } from "../components/QuickSwitcher";

import type { QuickSwitcherProps } from "../components/QuickSwitcher";
import type { IndexStatus, NamesListing } from "../search/types";

const status = (total: number, state: IndexStatus["state"] = "ready") => ({
  handle: "h",
  state,
  indexed: total,
  total,
});

const fakeSearch = (
  paths: string[],
  listing?: Partial<NamesListing> | Error,
) => ({
  listNames: vi.fn(async (): Promise<NamesListing> => {
    if (listing instanceof Error) {
      throw listing;
    }
    return { paths, status: status(paths.length), ...listing };
  }),
  subscribe: vi.fn(async () => () => {}),
});

const PATHS = [
  "Archive/old-notes.excalidraw",
  "Projects/vault-design.excalidraw",
  "Projects/roadmap.excalidraw",
  "sketch.excalidraw",
];
const COMMAND_IDS = [
  "settings.open",
  "view.toggleNavigator",
  "vault.newDrawing",
];

const setup = async (props: Partial<QuickSwitcherProps> = {}) => {
  const handlers = {
    onOpenDrawing: vi.fn(),
    onRunCommand: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <QuickSwitcher
      search={fakeSearch(PATHS)}
      handle="h"
      commandIds={COMMAND_IDS}
      platform="mac"
      ownerDocument={document}
      {...handlers}
      {...props}
    />,
  );
  await act(async () => {});
  return handlers;
};

const input = () => screen.getByRole("combobox");
const type = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(input(), { key: k, ...init });
const options = () => screen.getAllByRole("option");
const active = () =>
  options().findIndex((o) => o.getAttribute("aria-selected") === "true");

afterEach(cleanup);

describe("QuickSwitcher", () => {
  it("focuses the input and lists drawings then commands when empty", async () => {
    await setup();
    expect(input()).toHaveFocus();
    expect(options()).toHaveLength(PATHS.length + COMMAND_IDS.length);
    expect(options()[0]).toHaveTextContent("old-notes");
    expect(screen.getByText("Open settings")).toBeInTheDocument();
    expect(screen.getByText("⌘,")).toBeInTheDocument();
  });

  it("ranks the fuzzy match first and Enter opens it", async () => {
    const h = await setup();
    type("vdg");
    expect(options()[0]).toHaveTextContent("vault-design");
    expect(input()).toHaveAttribute("aria-activedescendant", options()[0].id);
    key("Enter");
    expect(h.onOpenDrawing).toHaveBeenCalledWith(
      "Projects/vault-design.excalidraw",
    );
  });

  it('">" lists commands only and Enter runs one', async () => {
    const h = await setup();
    type(">");
    expect(options()).toHaveLength(COMMAND_IDS.length);
    expect(screen.queryByText("Drawings")).toBeNull();
    type(">toggle");
    key("Enter");
    expect(h.onRunCommand).toHaveBeenCalledWith("view.toggleNavigator");
    expect(h.onOpenDrawing).not.toHaveBeenCalled();
  });

  it("wraps with the arrow keys", async () => {
    await setup();
    const n = options().length;
    expect(active()).toBe(0);
    key("ArrowUp");
    expect(active()).toBe(n - 1);
    key("ArrowDown");
    expect(active()).toBe(0);
  });

  it("closes on Escape and on the switcher chord", async () => {
    const h = await setup();
    key("Escape");
    expect(h.onClose).toHaveBeenCalledTimes(1);
    key("p", { code: "KeyP", metaKey: true });
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });

  it("restores focus to the previous element on close", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    await setup();
    key("Escape");
    expect(button).toHaveFocus();
    button.remove();
  });

  it("shows a message when listing fails but commands still work", async () => {
    const h = await setup({ search: fakeSearch([], new Error("boom")) });
    expect(screen.getByRole("status")).toHaveTextContent("boom");
    type(">settings");
    key("Enter");
    expect(h.onRunCommand).toHaveBeenCalledWith("settings.open");
  });

  it("shows indexing progress with the names known so far", async () => {
    await setup({
      search: fakeSearch(PATHS, {
        status: { ...status(10, "building"), indexed: 4 },
      }),
    });
    expect(screen.getByText("Indexing… 4/10")).toBeInTheDocument();
    expect(options().length).toBeGreaterThan(0);
  });

  it("hover and click pick a row", async () => {
    const h = await setup();
    fireEvent.mouseMove(options()[2]);
    expect(active()).toBe(2);
    fireEvent.click(options()[2]);
    expect(h.onOpenDrawing).toHaveBeenCalledWith("Projects/roadmap.excalidraw");
  });
});

describe("QuickSwitcher keystroke latency (5,000 drawings, jsdom)", () => {
  it("stays within the budget", async () => {
    const paths = Array.from(
      { length: 5000 },
      (_, i) =>
        `Folder${i % 40}/sub${i % 7}/drawing-${i}-${(i * 7919).toString(
          36,
        )}.excalidraw`,
    );
    await setup({ search: fakeSearch(paths) });
    const samples: number[] = [];
    for (const q of [
      "d",
      "dr",
      "dra",
      "draw",
      "drawi",
      "f1 dr 12",
      "zq",
      ">",
    ]) {
      const t0 = performance.now();
      type(q);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 =
      samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    console.info(
      `quick switcher keystroke: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(
        1,
      )}ms`,
    );
    expect(p95).toBeLessThan(50);
  });
});
