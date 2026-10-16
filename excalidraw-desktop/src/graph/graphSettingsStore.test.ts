import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGraphSettingsSaver,
  freshGraphSettings,
  graphSettingsChanges,
  loadGraphSettings,
  parseGraphSettings,
} from "./graphSettingsStore";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";

import type { InvokeFn } from "../vault/DesktopVaultRepository";

const fakeBackend = (file: Record<string, unknown> = {}) => {
  const calls: { key: string; value: unknown }[][] = [];
  const invoke = vi.fn(async (cmd: string, args?: any) => {
    if (cmd === "load_vault_settings") {
      return { settings: JSON.parse(JSON.stringify(file)) };
    }
    calls.push(args.changes);
    const graph = ((file.graph as any) ??= {});
    for (const { key, value } of args.changes) {
      const k = key.replace(/^graph\./, "");
      if (value === null) {
        delete graph[k];
      } else {
        graph[k] = value;
      }
    }
  }) as unknown as InvokeFn;
  return { invoke, calls, file };
};

afterEach(() => vi.useRealTimers());

describe("parseGraphSettings", () => {
  it("returns the defaults for missing or malformed input", () => {
    for (const bad of [undefined, null, 5, [], { graph: 3 }, { graph: [] }]) {
      expect(parseGraphSettings(bad)).toEqual(DEFAULT_GRAPH_SETTINGS);
    }
  });

  it("clamps numbers, drops bad values and ignores unknown keys", () => {
    const s = parseGraphSettings({
      graph: {
        node_size: 99,
        link_thickness: -3,
        text_fade: "x",
        force_repel: 1000,
        force_distance: 1,
        force_centre: Number.NaN,
        colour_by: "rainbow",
        local_depth: 7,
        show_tags: "yes",
        arrows: true,
        mystery: 1,
        groups: [
          { query: "tag:#a", colour: "#f00" },
          { query: 1, colour: "#0f0" },
          null,
        ],
      },
    });
    expect(s.nodeSize).toBe(5);
    expect(s.linkThickness).toBe(0.2);
    expect(s.textFade).toBe(DEFAULT_GRAPH_SETTINGS.textFade);
    expect(s.forces.repel).toBe(20);
    expect(s.forces.linkDistance).toBe(5);
    expect(s.forces.centre).toBe(DEFAULT_GRAPH_SETTINGS.forces.centre);
    expect(s.colourBy).toBe("folder");
    expect(s.localDepth).toBe(2);
    expect(s.showTags).toBe(false);
    expect(s.arrows).toBe(true);
    expect(s.groups).toEqual([{ query: "tag:#a", colour: "#f00" }]);
    expect("mystery" in s).toBe(false);
  });

  it("never shares mutable defaults between calls", () => {
    const a = parseGraphSettings({});
    a.forces.repel = 1;
    a.groups.push({ query: "x", colour: "y" });
    expect(parseGraphSettings({})).toEqual(DEFAULT_GRAPH_SETTINGS);
    expect(DEFAULT_GRAPH_SETTINGS.groups).toEqual([]);
  });
});

describe("graphSettingsChanges", () => {
  it("is empty when nothing changed and nulls values reset to default", () => {
    const base = freshGraphSettings();
    expect(graphSettingsChanges(base, freshGraphSettings())).toEqual([]);
    const changed = { ...base, showTags: true };
    expect(graphSettingsChanges(base, changed)).toEqual([
      { key: "graph.show_tags", value: true },
    ]);
    expect(graphSettingsChanges(changed, base)).toEqual([
      { key: "graph.show_tags", value: null },
    ]);
  });
});

describe("load and save round trip", () => {
  it("saves debounced, writes only the diff, and loads back identically", async () => {
    vi.useFakeTimers();
    const { invoke, calls, file } = fakeBackend();
    const loaded = await loadGraphSettings("h", invoke);
    expect(loaded).toEqual(DEFAULT_GRAPH_SETTINGS);
    const saver = createGraphSettingsSaver("h", loaded, invoke);

    const next = {
      ...loaded,
      showOrphans: false,
      groups: [{ query: "path:Notes", colour: "#123456" }],
      forces: { ...loaded.forces, repel: 5 },
    };
    saver.save({ ...next, nodeSize: 2 });
    saver.save(next);
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].map((c) => c.key).sort()).toEqual([
      "graph.force_repel",
      "graph.groups",
      "graph.show_orphans",
    ]);

    expect(await loadGraphSettings("h", invoke)).toEqual(next);

    saver.save(loaded);
    await saver.flush();
    expect(calls).toHaveLength(2);
    expect(file.graph).toEqual({});
  });

  it("falls back to defaults when the load fails and retries after a failed write", async () => {
    const failing = vi.fn(async () => {
      throw new Error("nope");
    }) as unknown as InvokeFn;
    expect(await loadGraphSettings("h", failing)).toEqual(
      DEFAULT_GRAPH_SETTINGS,
    );
    const saver = createGraphSettingsSaver(
      "h",
      freshGraphSettings(),
      failing,
      0,
    );
    saver.save({ ...freshGraphSettings(), arrows: true });
    await saver.flush();
    saver.save({ ...freshGraphSettings(), arrows: true });
    await saver.flush();
    expect(failing).toHaveBeenCalledTimes(3); // load + two attempts, not skipped
  });
});
