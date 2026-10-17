import { describe, expect, it, vi } from "vitest";

import { linkAt, linkBoxesOf } from "./linkBoxes";

import type { VersionedText } from "./linkBoxes";

const measure = (t: string) => t.length * 10;

export const textEl = (over: Partial<VersionedText> = {}): VersionedText => ({
  id: "t",
  type: "text",
  x: 100,
  y: 100,
  width: 160,
  height: 25,
  angle: 0,
  fontSize: 20,
  fontFamily: 1,
  lineHeight: 1.25,
  textAlign: "left",
  text: "go [[Notes]] now",
  version: 1,
  ...over,
});

describe("linkBoxes", () => {
  it("measures once per element version", () => {
    const m = vi.fn(measure);
    const el = textEl();
    const a = linkBoxesOf(el, m);
    const calls = m.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(linkBoxesOf(el, m)).toBe(a);
    expect(m.mock.calls.length).toBe(calls);
    // same object, new version: miss
    el.version = 2;
    linkBoxesOf(el, m);
    expect(m.mock.calls.length).toBeGreaterThan(calls);
    // new object (Excalidraw replaces elements on change): miss
    const before = m.mock.calls.length;
    linkBoxesOf({ ...el }, m);
    expect(m.mock.calls.length).toBeGreaterThan(before);
  });

  it("hits only inside the link fragment, topmost first", () => {
    const el = textEl();
    // "go " = 30px, "[[Notes]]" = 90px -> x 130..220, y 100..125
    expect(linkAt([el], { x: 150, y: 110 }, measure)?.span.target).toBe(
      "Notes",
    );
    expect(linkAt([el], { x: 110, y: 110 }, measure)).toBeNull();
    expect(linkAt([el], { x: 150, y: 140 }, measure)).toBeNull();
    const top = textEl({ id: "top", text: "[[Other]]" });
    const hit = linkAt([el, top], { x: 120, y: 110 }, measure);
    expect(hit?.element.id).toBe("top");
  });

  it("skips deleted, non-text and link-less elements", () => {
    const els = [
      textEl({ isDeleted: true }),
      textEl({ type: "rectangle" }),
      textEl({ text: "plain" }),
    ];
    expect(linkAt(els, { x: 150, y: 110 }, measure)).toBeNull();
  });

  it("handles rotation and centre alignment", () => {
    const rot = textEl({ angle: Math.PI / 2, x: 100, y: 100, width: 160 });
    // centre (180, 112.5); local link point (175,112) rotated 90deg cw about centre
    const cx = 180;
    const cy = 112.5;
    const lx = 175 - cx;
    const ly = 112.5 - cy;
    const p = { x: cx - ly, y: cy + lx };
    expect(linkAt([rot], p, measure)?.span.target).toBe("Notes");
    expect(linkAt([rot], { x: 120, y: 112 }, measure)).toBeNull();

    const centered = textEl({ textAlign: "center", width: 200, text: "[[A]]" });
    // line width 50 centred in 200: x 175..225
    expect(linkAt([centered], { x: 200, y: 110 }, measure)).not.toBeNull();
    expect(linkAt([centered], { x: 110, y: 110 }, measure)).toBeNull();
  });
});
