import { Profiler } from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TabStrip } from "./TabStrip";
import { createTabStore } from "./tabStore";
import {
  activate,
  initialState,
  openPath,
  setMissing,
  setView,
  togglePin,
} from "./tabsModel";

import type { TabStore } from "./tabStore";

const storeWith = (paths: string[]): TabStore => {
  const store = createTabStore();
  paths.forEach((p, i) =>
    store.update((s) =>
      openPath(s, p, { target: i === 0 ? "current" : "new", position: "end" }),
    ),
  );
  return store;
};

const setup = (store: TabStore, extra = {}) => {
  const cbs = {
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onNewTab: vi.fn(),
  };
  const utils = render(<TabStrip store={store} {...cbs} {...extra} />);
  return { ...cbs, ...utils };
};

describe("TabStrip", () => {
  it("renders tabs from the store with names and vault-path titles", () => {
    setup(storeWith(["A/one.excalidraw", "two.excalidraw"]));
    const tabs = screen.getAllByTestId("vault-tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toBe("one");
    expect(tabs[0].getAttribute("title")).toBe("A/one.excalidraw");
    expect(tabs[0].dataset.path).toBe("A/one.excalidraw");
    expect(tabs[0].dataset.active).toBe("false");
    expect(tabs[1].dataset.active).toBe("true");
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe(
      "Open drawings",
    );
  });

  it("shows the home tab as New tab", () => {
    setup(createTabStore());
    expect(screen.getByTestId("vault-tab").textContent).toBe("New tab");
  });

  it("click activates through the callback", () => {
    const { onActivate } = setup(storeWith(["a.excalidraw", "b.excalidraw"]));
    fireEvent.click(screen.getAllByTestId("vault-tab")[0]);
    expect(onActivate).toHaveBeenCalledWith("t1");
  });

  it("close button and middle click close; neither activates", () => {
    const { onClose, onActivate } = setup(
      storeWith(["a.excalidraw", "b.excalidraw"]),
    );
    fireEvent.click(screen.getAllByTestId("vault-tab-close")[0]);
    expect(onClose).toHaveBeenLastCalledWith("t1");
    fireEvent(
      screen.getAllByTestId("vault-tab")[1],
      new MouseEvent("auxclick", {
        button: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onClose).toHaveBeenLastCalledWith("t2");
    expect(onActivate).not.toHaveBeenCalled();
    expect(
      screen.getAllByTestId("vault-tab-close")[0].getAttribute("aria-label"),
    ).toBe("Close a");
  });

  it("plus and double click on empty space create a tab; double click on a tab does not", () => {
    const { onNewTab } = setup(storeWith(["a.excalidraw"]));
    fireEvent.click(screen.getByTestId("vault-tab-new"));
    expect(onNewTab).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(screen.getByTestId("vault-tab"));
    expect(onNewTab).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(screen.getByTestId("vault-tabs"));
    expect(onNewTab).toHaveBeenCalledTimes(2);
  });

  it("mousedown on a tab does not take focus", () => {
    setup(storeWith(["a.excalidraw"]));
    const notPrevented = fireEvent.mouseDown(screen.getByTestId("vault-tab"));
    expect(notPrevented).toBe(false);
  });

  it("keyboard: roving tabindex, arrows wrap, Home/End, Enter and Space activate, Delete closes", () => {
    const { onActivate, onClose } = setup(
      storeWith(["a.excalidraw", "b.excalidraw", "c.excalidraw"]),
    );
    const tabs = () => screen.getAllByTestId("vault-tab");
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
    ]);

    act(() => tabs()[2].focus());
    fireEvent.keyDown(tabs()[2], { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs()[0]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(tabs()[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs()[2]);
    fireEvent.keyDown(tabs()[2], { key: "Home" });
    expect(document.activeElement).toBe(tabs()[0]);
    fireEvent.keyDown(tabs()[0], { key: "End" });
    expect(document.activeElement).toBe(tabs()[2]);

    // manual activation: moving focus never activates
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.keyDown(tabs()[1], { key: "Enter" });
    expect(onActivate).toHaveBeenLastCalledWith("t2");
    fireEvent.keyDown(tabs()[0], { key: " " });
    expect(onActivate).toHaveBeenLastCalledWith("t1");
    fireEvent.keyDown(tabs()[1], { key: "Delete" });
    expect(onClose).toHaveBeenCalledWith("t2");
  });

  it("disambiguates duplicate names with the parent folder", () => {
    setup(storeWith(["DP/Intro.excalidraw", "OS/Intro.excalidraw"]));
    expect(
      screen.getAllByTestId("vault-tab").map((t) => t.textContent),
    ).toEqual(["Intro · DP/", "Intro · OS/"]);
  });

  it("marks missing tabs and pinned tabs", () => {
    const store = storeWith(["a.excalidraw", "b.excalidraw"]);
    store.update((s) => setMissing(s, "a.excalidraw", true));
    store.update((s) => togglePin(s, "t2"));
    setup(store);
    const tabs = screen.getAllByTestId("vault-tab");
    const pinned = tabs.find((t) => t.dataset.path === "b.excalidraw")!;
    const missing = tabs.find((t) => t.dataset.path === "a.excalidraw")!;
    expect(missing.className).toContain("vault-tabs__tab--missing");
    expect(pinned.className).toContain("vault-tabs__tab--pinned");
    expect(pinned.querySelector("[data-testid=vault-tab-close]")).toBeNull();
    expect(pinned.getAttribute("aria-label")).toBe("b (pinned)");
  });

  it("shows save state on the active tab only", () => {
    const store = storeWith(["a.excalidraw", "b.excalidraw"]);
    const { rerender, onActivate, onClose, onNewTab } = setup(store, {
      activeStatus: "dirty",
    });
    expect(screen.getAllByLabelText("Unsaved changes")).toHaveLength(1);
    const props = { store, onActivate, onClose, onNewTab };
    rerender(<TabStrip {...props} activeStatus="conflict" />);
    expect(screen.getAllByLabelText("Save conflict")).toHaveLength(1);
    rerender(<TabStrip {...props} activeStatus="error" />);
    expect(screen.getAllByLabelText("Save failed")).toHaveLength(1);
    rerender(<TabStrip {...props} activeStatus="saved" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("scrolls the active tab into view when it changes", () => {
    const store = storeWith(["a.excalidraw", "b.excalidraw"]);
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    setup(store);
    spy.mockClear();
    act(() => store.update((s) => activate(s, "t1")));
    expect(spy).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("does not re-render when only a tab's view changes", () => {
    const store = storeWith(["a.excalidraw", "b.excalidraw"]);
    let commits = 0;
    render(
      <Profiler id="strip" onRender={() => commits++}>
        <TabStrip
          store={store}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onNewTab={vi.fn()}
        />
      </Profiler>,
    );
    const before = commits;
    act(() =>
      store.update((s) =>
        setView(s, "t2", { scrollX: 5, scrollY: 6, zoom: 2 }),
      ),
    );
    expect(commits).toBe(before);
    act(() => store.update((s) => activate(s, "t1")));
    expect(commits).toBe(before + 1);
  });

  it("perf: a 50-tab activate commit stays cheap", () => {
    const store = createTabStore(initialState());
    for (let i = 0; i < 50; i++) {
      store.update((s) =>
        openPath(s, `dir${i % 7}/drawing-${i}.excalidraw`, {
          target: i === 0 ? "current" : "new",
          position: "end",
        }),
      );
    }
    const durations: number[] = [];
    render(
      <Profiler
        id="strip"
        onRender={(_id, phase, actual) => {
          if (phase === "update") {
            durations.push(actual);
          }
        }}
      >
        <TabStrip
          store={store}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onNewTab={vi.fn()}
        />
      </Profiler>,
    );
    expect(screen.getAllByTestId("vault-tab")).toHaveLength(50);
    for (let i = 0; i < 20; i++) {
      act(() => store.update((s) => activate(s, `t${(i % 50) + 1}`)));
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // eslint-disable-next-line no-console
    console.log(
      `[tabs perf] 50-tab activate commit (jsdom): median ${median.toFixed(
        2,
      )} ms, max ${sorted[sorted.length - 1].toFixed(
        2,
      )} ms (budget 3 ms in app)`,
    );
    expect(median).toBeLessThan(30);
  });
});
