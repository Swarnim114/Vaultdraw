import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { DEFAULT_GRAPH_SETTINGS, type GraphViewProps } from "../graph/settings";

import type { GraphHostProps } from "../graph/GraphHost";
import type { InvokeFn } from "../vault/DesktopVaultRepository";

const viewLoaded = vi.fn();
let lastProps: (GraphViewProps & { fitNonce?: number }) | null = null;

vi.mock("../graph/GraphView", () => {
  viewLoaded();
  return {
    default: (props: GraphViewProps & { fitNonce?: number }) => {
      lastProps = props;
      return <div data-testid="graph-view">{props.mode}</div>;
    },
  };
});

const run = (id: string) =>
  act(async () => void (await getRegisteredHandler(id)?.()));

const makeInvoke = (graph: Record<string, unknown> = {}) => {
  const writes: unknown[] = [];
  const invoke = vi.fn(async (cmd: string, args?: any) => {
    if (cmd === "load_vault_settings") {
      return { settings: { graph } };
    }
    writes.push(args.changes);
  }) as unknown as InvokeFn;
  return { invoke, writes };
};

const mount = async (over: Partial<GraphHostProps> = {}) => {
  const { GraphHost } = await import("../graph/GraphHost");
  const props: GraphHostProps = {
    handle: "h",
    currentPath: "A.excalidraw",
    themeKey: "t1",
    onOpenDrawing: vi.fn(),
    onOpenChange: vi.fn(),
    onClosed: vi.fn(),
    invoke: makeInvoke().invoke,
    ...over,
  };
  return { props, ...render(<GraphHost {...props} />) };
};

afterEach(() => {
  vi.useRealTimers();
  lastProps = null;
});

describe("GraphHost", () => {
  it("does not import the graph view until first open", async () => {
    await mount();
    expect(viewLoaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId("graph-view")).toBeNull();
    await run("graph.open");
    await waitFor(() => screen.getByTestId("graph-view"));
    expect(viewLoaded).toHaveBeenCalledTimes(1);
  });

  it("open command toggles, local opens in local mode, Esc/close path restores focus", async () => {
    const { props } = await mount();
    await run("graph.open");
    await waitFor(() => screen.getByText("global"));
    expect(props.onOpenChange).toHaveBeenLastCalledWith(true);
    await run("graph.open");
    expect(screen.queryByTestId("graph-view")).toBeNull();
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false);

    await run("graph.openLocal");
    await waitFor(() => screen.getByText("local"));
    act(() => lastProps!.onClose()); // what Esc calls
    expect(screen.queryByTestId("graph-view")).toBeNull();
    expect(props.onClosed).toHaveBeenCalledTimes(2);
  });

  it("opening a drawing closes the graph and opens the path", async () => {
    const { props } = await mount();
    await run("graph.open");
    await waitFor(() => screen.getByTestId("graph-view"));
    act(() => lastProps!.onOpen("B/C.excalidraw"));
    expect(screen.queryByTestId("graph-view")).toBeNull();
    expect(props.onOpenDrawing).toHaveBeenCalledWith(
      "B/C.excalidraw",
      undefined,
    );
  });

  it("passes loaded per-vault settings, the theme key and shortcut lookup", async () => {
    const shortcutFor = vi.fn(() => "Alt+1");
    await mount({
      invoke: makeInvoke({ show_tags: false, node_size: 2 }).invoke,
      shortcutFor,
    });
    await run("graph.open");
    await waitFor(() => screen.getByTestId("graph-view"));
    expect(lastProps!.settings.showTags).toBe(false);
    expect(lastProps!.settings.nodeSize).toBe(2);
    expect(lastProps!.themeKey).toBe("t1");
    expect(lastProps!.shortcutFor).toBe(shortcutFor);
    expect(lastProps!.handle).toBe("h");
  });

  it("toggle commands open the graph, flip the setting and save it debounced", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { invoke, writes } = makeInvoke();
    await mount({ invoke });
    await run("graph.toggleTags");
    await waitFor(() => screen.getByTestId("graph-view"));
    expect(lastProps!.settings.showTags).toBe(!DEFAULT_GRAPH_SETTINGS.showTags);
    await run("graph.toggleOrphans");
    expect(lastProps!.settings.showOrphans).toBe(false);
    expect(writes).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(writes).toHaveLength(1);
    expect((writes[0] as any[]).map((c) => c.key).sort()).toEqual([
      "graph.show_orphans",
      "graph.show_tags",
    ]);
    await run("graph.toggleUnresolved");
    expect(lastProps!.settings.showUnresolved).toBe(
      !DEFAULT_GRAPH_SETTINGS.showUnresolved,
    );
  });

  it("fit opens the graph and bumps fitNonce each time (no synthetic key)", async () => {
    await mount();
    await run("graph.fit");
    await waitFor(() => screen.getByTestId("graph-view"));
    const first = lastProps!.fitNonce;
    expect(first).toBeGreaterThan(0);
    await run("graph.fit");
    expect(lastProps!.fitNonce).toBe(first! + 1);
  });

  it("local graph needs a current drawing; no vault means nothing opens", async () => {
    await mount({ currentPath: null });
    await run("graph.openLocal");
    expect(screen.queryByTestId("graph-view")).toBeNull();
  });

  it("unbinds its handlers on unmount", async () => {
    const { unmount } = await mount();
    expect(getRegisteredHandler("graph.open")).toBeDefined();
    unmount();
    expect(getRegisteredHandler("graph.open")).toBeUndefined();
  });
});
