import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActiveTabGate } from "./ActiveTabGate";
import { createTabStore } from "./tabStore";
import { openPath, setMissing } from "./tabsModel";

const setup = () => {
  const store = createTabStore();
  store.update((s) => openPath(s, "f/a.excalidraw", { target: "current" }));
  const onClose = vi.fn();
  const onSearch = vi.fn();
  render(
    <ActiveTabGate store={store} onClose={onClose} onSearch={onSearch}>
      <div>home</div>
    </ActiveTabGate>,
  );
  return { store, onClose, onSearch };
};

describe("ActiveTabGate", () => {
  it("shows the children for a normal tab", () => {
    setup();
    expect(screen.getByText("home")).toBeTruthy();
  });

  it("shows the placeholder when the active tab is missing, with working actions", () => {
    const { store, onClose, onSearch } = setup();
    act(() => store.update((s) => setMissing(s, "f/a.excalidraw", true)));
    expect(screen.getByTestId("missing-tab-placeholder")).toBeTruthy();
    screen.getByText("Close tab").click();
    screen.getByText("Search for it").click();
    expect(onClose).toHaveBeenCalled();
    expect(onSearch).toHaveBeenCalledWith("f/a.excalidraw");
    act(() => store.update((s) => setMissing(s, "f/a.excalidraw", false)));
    expect(screen.getByText("home")).toBeTruthy();
  });
});
