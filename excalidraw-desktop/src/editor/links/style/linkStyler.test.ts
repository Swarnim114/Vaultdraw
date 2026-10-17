import { afterEach, describe, expect, it, vi } from "vitest";

import * as element from "@excalidraw/element";
import { getTextRuns } from "@excalidraw/element";

import { LinkResolver } from "../../../links/resolve";

import { FALLBACK_ACCENT, LinkStyler } from "./linkStyler";

const text = (t: string, version = 1) =>
  ({
    id: "t",
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    angle: 0,
    text: t,
    fontSize: 20,
    fontFamily: 1,
    lineHeight: 1.25,
    textAlign: "left",
    version,
  } as never);

const make = (accent = { v: "#112233" }) => {
  const repaint = vi.fn();
  const styler = new LinkStyler({ repaint, readAccent: () => accent.v });
  return { styler, repaint, accent };
};
const opts = (over: object = {}) => ({
  enabled: true,
  linkColor: "accent",
  resolver: new LinkResolver(["A.excalidraw"]),
  currentPath: "x.excalidraw",
  ...over,
});

let active: LinkStyler[] = [];
const track = (s: LinkStyler) => {
  active.push(s);
  return s;
};
afterEach(() => {
  active.forEach((s) => s.dispose());
  active = [];
});

describe("LinkStyler", () => {
  it("does not install while disabled", () => {
    const spy = vi.spyOn(element, "setTextRunStyler");
    const { styler } = make();
    track(styler).update(opts({ enabled: false }));
    expect(styler.isInstalled).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("installs when enabled and styles links with the accent", () => {
    const { styler, repaint } = make();
    track(styler).update(opts());
    expect(styler.isInstalled).toBe(true);
    expect(repaint).toHaveBeenCalledTimes(1);
    const runs = getTextRuns(text("[[A]] [[B]]"), false)!;
    expect(runs.some((r) => r.underline === "solid")).toBe(true);
    expect(runs.some((r) => r.underline === "dashed")).toBe(true);
    expect(runs.find((r) => r.underline === "solid")!.color).toBe(
      "rgb(17,34,51)",
    );
    expect(getTextRuns(text("plain"), false)).toBeNull();
  });

  it("reads --vault-primary, falling back to the default accent", () => {
    const styler = track(new LinkStyler({ repaint: vi.fn() }));
    styler.update(opts());
    const color = () =>
      getTextRuns(text("[[A]]"), false)!.find((r) => r.underline)!.color;
    expect(color()).toBe("rgb(105,101,219)");
    expect(FALLBACK_ACCENT).toBe("#6965db");
  });

  it("removes the styler when disabled", () => {
    const { styler, repaint } = make();
    track(styler).update(opts());
    repaint.mockClear();
    styler.update(opts({ enabled: false }));
    expect(styler.isInstalled).toBe(false);
    expect(getTextRuns(text("[[A]]"), false)).toBeNull();
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it("invalidates only when a memoised target flips", () => {
    const inv = vi.spyOn(element, "invalidateTextRunStyles");
    const { styler, repaint } = make();
    track(styler).update(opts());
    getTextRuns(text("[[A]] [[B]]"), false);
    repaint.mockClear();
    styler.update(
      opts({ resolver: new LinkResolver(["A.excalidraw", "C.excalidraw"]) }),
    );
    expect(inv).not.toHaveBeenCalled();
    expect(repaint).not.toHaveBeenCalled();
    styler.update(
      opts({ resolver: new LinkResolver(["A.excalidraw", "B.excalidraw"]) }),
    );
    expect(inv).toHaveBeenCalledTimes(1);
    expect(repaint).toHaveBeenCalledTimes(1);
    inv.mockRestore();
  });

  it("invalidates when the colour setting changes", () => {
    const inv = vi.spyOn(element, "invalidateTextRunStyles");
    const { styler } = make();
    track(styler).update(opts());
    styler.update(opts({ linkColor: "#ff0000" }));
    expect(inv).toHaveBeenCalledTimes(1);
    const runs = getTextRuns(text("[[A]]"), false)!;
    expect(runs.find((r) => r.underline)!.color).toMatch(/^rgb\(/);
    inv.mockRestore();
  });

  it("invalidates when the accent variable changes", async () => {
    const inv = vi.spyOn(element, "invalidateTextRunStyles");
    const { styler, accent } = make();
    track(styler).update(opts());
    getTextRuns(text("[[A]]"), false);
    accent.v = "#445566";
    document.documentElement.style.setProperty(
      "--x-test",
      String(Math.random()),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(inv).toHaveBeenCalledTimes(1);
    document.documentElement.style.removeProperty("--x-test");
    inv.mockRestore();
  });

  it("hands the hook back when a later styler goes away", () => {
    const a = track(make().styler);
    a.update(opts());
    const b = track(make({ v: "#abcdef" }).styler);
    b.update(opts());
    b.dispose();
    const runs = getTextRuns(text("[[A]]"), false)!;
    expect(runs.find((r) => r.underline)!.color).toBe("rgb(17,34,51)");
    a.dispose();
    expect(getTextRuns(text("[[A]]"), false)).toBeNull();
  });
});
