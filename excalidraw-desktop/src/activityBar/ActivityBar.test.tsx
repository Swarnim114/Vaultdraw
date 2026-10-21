import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { libraryPanelStore } from "../library/libraryPanelState";

import { ActivityBar } from "./ActivityBar";

afterEach(cleanup);

const setup = (
  over: { available?: (id: string) => boolean; drawingOpen?: boolean } = {},
) => {
  const run = vi.fn(() => true);
  render(
    <ActivityBar
      run={run}
      isAvailable={over.available ?? (() => true)}
      hasHandler={(id) => id !== "tags.focusPane"}
      drawingOpen={over.drawingOpen ?? true}
      writable
    />,
  );
  return run;
};

describe("ActivityBar", () => {
  it("hides entries without a handler and runs commands on click", () => {
    const run = setup();
    expect(screen.queryByTestId("activity-bar-tags")).toBeNull();
    fireEvent.click(screen.getByTestId("activity-bar-graph"));
    expect(run).toHaveBeenCalledWith("graph.open");
  });

  it("disabled entries stay focusable and do nothing", () => {
    const run = setup({
      available: (id) => id !== "history.toggle",
      drawingOpen: false,
    });
    const button = screen.getByTestId("activity-bar-history");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "History - Open a drawing first");
    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
  });

  it("roves with the arrow keys without wrapping", () => {
    setup();
    const first = screen.getByTestId("activity-bar-library");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByTestId("activity-bar-history"),
    );
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByTestId("activity-bar-settings"),
    );
    expect(screen.getByTestId("activity-bar-settings")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(first).toHaveAttribute("tabindex", "-1");
  });

  it("does not reopen a panel that its own pointerdown just closed", () => {
    const run = setup();
    const button = screen.getByTestId("activity-bar-library");
    libraryPanelStore.publish(true);
    fireEvent.pointerDown(button);
    libraryPanelStore.publish(false); // the sidebar's outside-click close
    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
    fireEvent.pointerDown(button); // now closed: a click opens it again
    fireEvent.click(button);
    expect(run).toHaveBeenCalledWith("library.toggle");
  });
});
