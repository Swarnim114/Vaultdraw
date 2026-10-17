import { describe, expect, it, vi } from "vitest";

import { findLinks } from "../../../links/grammar";
import * as grammar from "../../../links/grammar";

import { buildLinkRuns, linkPalette, linkSpansOf } from "./linkRuns";

const P = linkPalette("#336699");
const el = (text: string, version = 1, extra: object = {}) =>
  ({
    id: "t",
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    angle: 0,
    text,
    fontSize: 20,
    fontFamily: 1,
    lineHeight: 1.25,
    textAlign: "left",
    version,
    ...extra,
  } as never);

describe("linkPalette", () => {
  it("derives alpha variants from a hex colour", () => {
    expect(P).toEqual({
      link: "rgb(51,102,153)",
      dim: "rgba(51,102,153,0.5)",
      unresolved: "rgba(51,102,153,0.6)",
      unresolvedDim: "rgba(51,102,153,0.35)",
    });
  });
  it("accepts rgb() input and passes unknown strings through", () => {
    expect(linkPalette("rgb(1, 2, 3)").dim).toBe("rgba(1,2,3,0.5)");
    expect(linkPalette("tomato").dim).toBe("tomato");
  });
});

describe("linkSpansOf", () => {
  it("returns an empty list without parsing when there is no [[", () => {
    const spy = vi.spyOn(grammar, "findLinks");
    expect(linkSpansOf(el("plain"))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("caches per element and version", () => {
    const e = el("see [[A]]", 1);
    const a = linkSpansOf(e);
    expect(linkSpansOf(e)).toBe(a);
    const e2 = { ...(e as object), text: "see [[B]]", version: 2 } as never;
    expect(linkSpansOf(e2)[0].target).toBe("B");
  });
  it("recomputes when the version changes on the same object", () => {
    const e = el("[[A]]", 1) as { text: string; version: number };
    const a = linkSpansOf(e as never);
    e.text = "[[B]] ";
    e.version = 2;
    expect(linkSpansOf(e as never)).not.toBe(a);
    expect(linkSpansOf(e as never)[0].target).toBe("B");
  });
  it("maps wrapped text 1:1 onto element.text", () => {
    const e = el("a [[Long\nName]] b", 1, { containerId: "c" });
    const [s] = linkSpansOf(e);
    expect(s.target).toBe("Long Name");
    expect(s.start).toBe(2);
    expect(s.end).toBe(15);
  });
});

describe("buildLinkRuns", () => {
  it("styles a plain link: dim brackets, solid underlined name", () => {
    const text = "x [[Note]] y";
    const runs = buildLinkRuns(text, findLinks(text), P, () => true);
    expect(runs).toEqual([
      { start: 2, end: 4, color: P.dim },
      { start: 4, end: 8, color: P.link, underline: "solid" },
      { start: 8, end: 10, color: P.dim },
    ]);
  });
  it("dims target| and emphasises the label", () => {
    const text = "[[Note|Shown]]";
    const runs = buildLinkRuns(text, findLinks(text), P, () => true);
    expect(runs).toEqual([
      { start: 0, end: 2, color: P.dim },
      { start: 2, end: 7, color: P.dim },
      { start: 7, end: 12, color: P.link, underline: "solid" },
      { start: 12, end: 14, color: P.dim },
    ]);
  });
  it("uses unresolved colours and a dashed underline", () => {
    const text = "[[Gone]]";
    const runs = buildLinkRuns(text, findLinks(text), P, () => false);
    expect(runs).toEqual([
      { start: 0, end: 2, color: P.unresolvedDim },
      { start: 2, end: 6, color: P.unresolved, underline: "dashed" },
      { start: 6, end: 8, color: P.unresolvedDim },
    ]);
  });
});
