import { describe, expect, it } from "vitest";

import { API } from "../../../packages/excalidraw/tests/helpers/api";

import {
  nearestStrokeWidthKey,
  newToolSession,
  styleFromAppState,
  styleFromElement,
  styleToAppState,
  switchTool,
  type ToolSession,
} from "./toolApply";

import type { ToolDefaults } from "./toolStyles";

const base = {
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid",
  currentItemStrokeWidthKey: "medium",
  currentItemStrokeStyle: "solid",
  currentItemRoughness: 1,
  currentItemRoundness: "round",
  currentItemOpacity: 100,
  currentItemArrowType: "round",
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: "arrow",
  currentItemFontFamily: 5,
  currentItemFontSize: 20,
  currentItemTextAlign: "left",
} as never;

const defaults: ToolDefaults = {
  arrow: {
    stroke_color: "#f08c00",
    stroke_width: 3,
    stroke_style: "dotted",
    start_arrowhead: "none",
    end_arrowhead: "triangle",
  },
  line: { stroke_color: "#2f9e44", stroke_width: 4 },
};

/** Runs a transition and keeps the editor state the way the hook would. */
function runner(initial: Record<string, unknown> = base as never) {
  let state: Record<string, unknown> = { ...initial };
  let session: ToolSession = newToolSession();
  let tool: string | null = null;
  return {
    get state() {
      return state;
    },
    get session() {
      return session;
    },
    /** Something other than us changes the state (user, pen preset...). */
    set(patch: Record<string, unknown>) {
      state = { ...state, ...patch };
    },
    /** An editor change with the same tool: lastSeen follows. */
    observe() {
      session.lastSeen = state as never;
    },
    go(next: string | null, d: ToolDefaults = defaults, same = {}) {
      this.observe();
      const prev = { ...state };
      session.lastSeen = prev as never;
      state = { ...state, ...same };
      const out = switchTool(session, next, state as never, d);
      state = { ...state, ...out.patch };
      session = out.session;
      tool = next;
      session.lastSeen = state as never;
      return out.patch;
    },
    get tool() {
      return tool;
    },
  };
}

describe("styleToAppState", () => {
  it("maps only the set keys", () => {
    expect(
      styleToAppState("arrow", {
        stroke_color: "#f08c00",
        stroke_width: 3,
        stroke_style: "dotted",
        arrow_type: "elbow",
        start_arrowhead: "none",
        end_arrowhead: "circle",
        roughness: 0,
        opacity: 50,
      }),
    ).toEqual({
      currentItemStrokeColor: "#f08c00",
      currentItemStrokeWidthKey: "medium",
      currentItemStrokeStyle: "dotted",
      currentItemArrowType: "elbow",
      currentItemStartArrowhead: null,
      currentItemEndArrowhead: "circle",
      currentItemRoughness: 0,
      currentItemOpacity: 50,
    });
    expect(styleToAppState("arrow", {})).toEqual({});
  });

  it("maps shape and text keys, ignoring keys the tool lacks", () => {
    expect(
      styleToAppState("rectangle", {
        background_color: "#ffec99",
        fill_style: "hachure",
        roundness: "sharp",
        font_size: 30 as never,
      }),
    ).toEqual({
      currentItemBackgroundColor: "#ffec99",
      currentItemFillStyle: "hachure",
      currentItemRoundness: "sharp",
    });
    expect(
      styleToAppState("text", {
        font_family: 6,
        font_size: 28,
        text_align: "center",
      }),
    ).toEqual({
      currentItemFontFamily: 6,
      currentItemFontSize: 28,
      currentItemTextAlign: "center",
    });
  });

  it("picks the nearest width key, ties to the lower", () => {
    expect(nearestStrokeWidthKey(0.5)).toBe("thin");
    expect(nearestStrokeWidthKey(1.5)).toBe("thin");
    expect(nearestStrokeWidthKey(3)).toBe("medium");
    expect(nearestStrokeWidthKey(3.1)).toBe("bold");
    expect(nearestStrokeWidthKey(40)).toBe("bold");
  });
});

describe("styleFromAppState", () => {
  it("reads every key of the tool", () => {
    expect(styleFromAppState("arrow", base)).toEqual({
      stroke_color: "#1e1e1e",
      stroke_width: 2,
      stroke_style: "solid",
      roughness: 1,
      opacity: 100,
      arrow_type: "round",
      start_arrowhead: "none",
      end_arrowhead: "arrow",
    });
    expect(styleFromAppState("text", base)).toEqual({
      stroke_color: "#1e1e1e",
      opacity: 100,
      font_family: 5,
      font_size: 20,
      text_align: "left",
    });
  });

  it("uses the px override and drops invalid values", () => {
    const style = styleFromAppState(
      "line",
      { ...(base as object), currentItemEndArrowhead: "weird" } as never,
      3,
    );
    expect(style.stroke_width).toBe(3);
    const bad = styleFromAppState("rectangle", {
      ...(base as object),
      currentItemFillStyle: "weird",
    } as never);
    expect("fill_style" in bad).toBe(false);
    expect(bad.fill_style).toBeUndefined();
  });

  it("round-trips through styleToAppState", () => {
    const style = styleFromAppState("arrow", base);
    expect(styleToAppState("arrow", style)).toMatchObject({
      currentItemStrokeColor: "#1e1e1e",
      currentItemStrokeWidthKey: "medium",
      currentItemStartArrowhead: null,
    });
  });
});

describe("styleFromElement", () => {
  it("reads a rectangle", () => {
    const el = API.createElement({
      type: "rectangle",
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fillStyle: "hachure",
      strokeWidth: 3,
      strokeStyle: "dashed",
      roughness: 0,
      opacity: 70,
      roundness: null,
    });
    expect(styleFromElement("rectangle", el)).toEqual({
      stroke_color: "#e03131",
      background_color: "#ffc9c9",
      fill_style: "hachure",
      stroke_width: 3,
      stroke_style: "dashed",
      roughness: 0,
      opacity: 70,
      roundness: "sharp",
    });
  });

  it("reads arrow type and arrowheads", () => {
    const sharp = API.createElement({
      type: "arrow",
      strokeWidth: 3,
      startArrowhead: null,
      endArrowhead: "triangle",
      roundness: null,
    });
    expect(styleFromElement("arrow", sharp)).toMatchObject({
      stroke_width: 3,
      arrow_type: "sharp",
      start_arrowhead: "none",
      end_arrowhead: "triangle",
    });
    const elbow = API.createElement({ type: "arrow", elbowed: true });
    expect(styleFromElement("arrow", elbow).arrow_type).toBe("elbow");
    const round = API.createElement({
      type: "arrow",
      roundness: { type: 2 },
    });
    expect(styleFromElement("arrow", round).arrow_type).toBe("round");
  });

  it("reads text", () => {
    const el = API.createElement({
      type: "text",
      text: "hi",
      fontFamily: 6,
      fontSize: 28,
      textAlign: "center",
    });
    expect(styleFromElement("text", el)).toMatchObject({
      font_family: 6,
      font_size: 28,
      text_align: "center",
    });
  });
});

describe("switchTool", () => {
  it("applies a configured tool on entry and restores on leave", () => {
    const r = runner();
    const entry = r.go("arrow");
    expect(entry).toMatchObject({
      currentItemStrokeColor: "#f08c00",
      currentItemStrokeStyle: "dotted",
      currentItemStartArrowhead: null,
      currentItemEndArrowhead: "triangle",
    });
    expect(r.session.tool).toBe("arrow");
    expect(r.session.strokeWidthPx).toBe(3);
    r.go("selection");
    expect(r.state).toMatchObject(base as object);
    expect(r.session.tool).toBeNull();
  });

  it("does nothing for unconfigured and non-styled tools", () => {
    const r = runner();
    expect(r.go("rectangle")).toEqual({});
    expect(r.go("freedraw")).toEqual({});
    expect(r.go("selection")).toEqual({});
    expect(r.go("hand")).toEqual({});
    expect(r.go("arrow", { arrow: {} })).toEqual({});
  });

  it("does not leak into an unconfigured tool", () => {
    const r = runner();
    r.go("arrow");
    const leave = r.go("rectangle");
    expect(r.state.currentItemStrokeColor).toBe("#1e1e1e");
    expect(r.state.currentItemStrokeStyle).toBe("solid");
    expect(leave.currentItemStrokeColor).toBe("#1e1e1e");
  });

  it("restores a mid-session change on leave (and re-entry starts from the default)", () => {
    const r = runner();
    r.go("arrow");
    r.set({ currentItemStrokeColor: "#e03131" });
    r.observe();
    r.go("selection");
    expect(r.state.currentItemStrokeColor).toBe("#1e1e1e");
    r.go("arrow");
    expect(r.state.currentItemStrokeColor).toBe("#f08c00");
  });

  it("keeps a value set in the same transition (pen preset)", () => {
    const r = runner();
    r.go("arrow");
    r.go("freedraw", defaults, { currentItemStrokeColor: "#ff0000" });
    expect(r.state.currentItemStrokeColor).toBe("#ff0000");
    // fields not touched by the pen are restored
    expect(r.state.currentItemStrokeStyle).toBe("solid");
  });

  it("composes arrow -> line into one patch from the original base", () => {
    const r = runner();
    r.go("arrow");
    const patch = r.go("line");
    expect(patch).toMatchObject({
      currentItemStrokeColor: "#2f9e44",
      currentItemStrokeWidthKey: "bold",
      // arrow-only fields are restored
      currentItemStrokeStyle: "solid",
      currentItemEndArrowhead: "arrow",
    });
    expect(r.session.base.currentItemStrokeColor).toBe("#1e1e1e");
    r.go("selection");
    expect(r.state).toMatchObject(base as object);
  });

  it("re-entering applies the default again", () => {
    const r = runner();
    r.go("arrow");
    r.go("selection");
    expect(r.go("arrow")).toMatchObject({
      currentItemStrokeColor: "#f08c00",
    });
  });

  it("re-applies changed defaults while the tool is active", () => {
    const r = runner();
    r.go("arrow");
    const next: ToolDefaults = {
      arrow: { stroke_color: "#1971c2", stroke_width: 1 },
    };
    r.go("arrow", next);
    expect(r.state).toMatchObject({
      currentItemStrokeColor: "#1971c2",
      currentItemStrokeWidthKey: "thin",
      // keys no longer set are back to base
      currentItemStrokeStyle: "solid",
      currentItemEndArrowhead: "arrow",
    });
    expect(r.session.strokeWidthPx).toBe(1);
    r.go("selection");
    expect(r.state).toMatchObject(base as object);
  });

  it("clearing the defaults while active restores the base", () => {
    const r = runner();
    r.go("arrow");
    r.go("arrow", {});
    expect(r.state).toMatchObject(base as object);
    expect(r.session.tool).toBeNull();
  });
});
