import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCRUB_SETTLE_MS, Timeline } from "../history/panel/Timeline";

import type { PanelThumbnails } from "../history/panel/thumbnails";
import type { VersionInfo } from "../history/types";

const version = (n: number): VersionInfo => ({
  id: `v${n}`,
  lineage: "l",
  createdAt: 1_700_000_000_000 + n * 60_000,
  device: "d",
  ownDevice: true,
  reason: n === 2 ? "checkpoint" : "auto",
  name: n === 2 ? "Two" : null,
  note: null,
  kind: "keyframe",
  sizeBytes: 1,
  elementCount: 3,
  availability: "local",
  headerLoaded: true,
});

// Newest first, as the repository lists them: v3, v2, v1.
const VERSIONS = [version(3), version(2), version(1)];

const thumbs = (): PanelThumbnails => ({
  eligible: () => true,
  request: vi.fn(async (id: string) => `data:thumb-${id}`),
  cancel: vi.fn(),
  clear: vi.fn(),
});

describe("Timeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (selectedId: string | null = null) => {
    const onSettle = vi.fn();
    const onScrub = vi.fn();
    const t = thumbs();
    const view = render(
      <Timeline
        versions={VERSIONS}
        selectedId={selectedId}
        thumbs={t}
        onSettle={onSettle}
        onScrub={onScrub}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Version timeline" });
    return { slider, onSettle, onScrub, thumbs: t, ...view };
  };

  it("is an accessible slider from the oldest version to Current", () => {
    const { slider } = setup();
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "3");
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(slider).toHaveAttribute("aria-valuetext", "Current");
  });

  it("ArrowLeft steps to the newest version and ArrowRight back to Current", () => {
    const { slider, onSettle } = setup();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    act(() => void vi.advanceTimersByTime(SCRUB_SETTLE_MS));
    expect(onSettle).toHaveBeenLastCalledWith("v3");
  });

  it("Home goes to the oldest, End to Current", () => {
    const { slider, onSettle } = setup("v3");
    fireEvent.keyDown(slider, { key: "Home" });
    act(() => void vi.advanceTimersByTime(SCRUB_SETTLE_MS));
    expect(onSettle).toHaveBeenLastCalledWith("v1");
    fireEvent.keyDown(slider, { key: "End" });
    act(() => void vi.advanceTimersByTime(SCRUB_SETTLE_MS));
    expect(onSettle).toHaveBeenLastCalledWith(null);
  });

  it("does not run past either end", () => {
    const { slider } = setup();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
  });

  it("settles once, 120 ms after the last move", () => {
    const { slider, onSettle, onScrub } = setup();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    act(() => void vi.advanceTimersByTime(SCRUB_SETTLE_MS - 20));
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    act(() => void vi.advanceTimersByTime(SCRUB_SETTLE_MS - 20));
    expect(onSettle).not.toHaveBeenCalled();
    expect(onScrub).toHaveBeenCalledTimes(2);
    act(() => void vi.advanceTimersByTime(20));
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith("v2");
  });

  it("shows only a label and a thumbnail while moving, nothing once settled", async () => {
    const { slider } = setup();
    expect(screen.queryByTestId("history-scrub-card")).toBeNull();
    fireEvent.keyDown(slider, { key: "Home" });
    const card = screen.getByTestId("history-scrub-card");
    expect(card).toHaveTextContent("Automatic");
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    expect(card.querySelector("img")).toHaveAttribute("src", "data:thumb-v1");
    act(() => void vi.advanceTimersByTime(SCRUB_SETTLE_MS));
    expect(screen.queryByTestId("history-scrub-card")).toBeNull();
  });

  it("reflects the selected version", () => {
    const { slider } = setup("v2");
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(slider.getAttribute("aria-valuetext")).toContain("Checkpoint: Two");
  });

  it("clears its settle timer on unmount", () => {
    const { slider, onSettle, unmount } = setup();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    unmount();
    act(() => void vi.advanceTimersByTime(SCRUB_SETTLE_MS * 2));
    expect(onSettle).not.toHaveBeenCalled();
  });
});
