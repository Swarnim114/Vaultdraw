import { describe, expect, it } from "vitest";

import {
  clientToScene,
  hitTestTextLink,
  shapeLinkAt,
  textLinksWithGeometry,
} from "./textLinkHitTest";

import type { TextLike } from "./textLinkHitTest";

const CHAR = 10;
const measure = (t: string) => t.length * CHAR;
const LINE_H = 25; // fontSize 20 * lineHeight 1.25

function text(over: Partial<TextLike> & { text: string }): TextLike {
  const lines = over.text.split("\n");
  return {
    id: "t",
    type: "text",
    x: 100,
    y: 50,
    width: Math.max(...lines.map((l) => l.length)) * CHAR,
    height: lines.length * LINE_H,
    angle: 0,
    fontSize: 20,
    fontFamily: 1,
    lineHeight: 1.25,
    textAlign: "left",
    ...over,
  };
}

// "See [[BFS]] now": span [4,11) -> x 140..210 when left aligned at x=100.
const hit = (el: TextLike, x: number, y: number) =>
  hitTestTextLink([el], { x, y }, measure);

describe("hitTestTextLink", () => {
  it("hits inside a span and misses outside it", () => {
    const el = text({ text: "See [[BFS]] now" });
    expect(hit(el, 145, 60)?.span.target).toBe("BFS");
    expect(hit(el, 205, 60)?.span.target).toBe("BFS");
    expect(hit(el, 125, 60)).toBeNull();
    expect(hit(el, 215, 60)).toBeNull();
    expect(hit(el, 145, 49)).toBeNull();
    expect(hit(el, 145, 50 + LINE_H + 1)).toBeNull();
  });

  it("picks the right line of a multi-line text", () => {
    const el = text({ text: "first\nsee [[A]]\n[[B|bee]] x" });
    expect(hit(el, 160, 50 + LINE_H + 5)?.span.target).toBe("A");
    expect(hit(el, 110, 50 + 2 * LINE_H + 5)?.span.target).toBe("B");
    expect(hit(el, 110, 55)).toBeNull();
  });

  it.each([
    ["left", 100],
    ["center", 100 + (150 - 60) / 2],
    ["right", 100 + (150 - 60)],
  ])("respects textAlign %s", (textAlign, lineX) => {
    // widest line is 15 chars (150px); the second line "[[abc]]" is 70px
    const el = text({ text: "123456789012345\n[[abc]]", textAlign });
    const lineW = 70;
    const x0 =
      100 +
      (150 - lineW) *
        ({ left: 0, center: 0.5, right: 1 } as const)[textAlign as "left"];
    expect(x0).toBeCloseTo(
      textAlign === "left" ? 100 : textAlign === "center" ? 140 : 180,
    );
    expect(lineX).toBeDefined();
    const y = 50 + LINE_H + 5;
    expect(hit(el, x0 + 5, y)?.span.target).toBe("abc");
    expect(hit(el, x0 + 65, y)?.span.target).toBe("abc");
    expect(hit(el, x0 - 5, y)).toBeNull();
    expect(hit(el, x0 + 75, y)).toBeNull();
  });

  it("resolves a link split across the lines of a wrapped bound label", () => {
    const el = text({
      text: "Read\n[[Graphs/BFS\nand DFS]] first",
      containerId: "box",
      textAlign: "center",
    });
    // line 2 and 3 are both part of the link
    expect(hit(el, 150, 50 + LINE_H + 5)?.span.target).toBe(
      "Graphs/BFS and DFS",
    );
    expect(hit(el, 150, 50 + 2 * LINE_H + 5)?.span.target).toBe(
      "Graphs/BFS and DFS",
    );
    // "Read" and " first" are not
    expect(hit(el, 150, 55)).toBeNull();
    const g = textLinksWithGeometry(el, measure);
    expect(g).toHaveLength(1);
    expect(g[0].fragments).toHaveLength(2);
  });

  it("does not link across a real newline in free text", () => {
    const el = text({ text: "[[a\nb]]" });
    expect(hit(el, 105, 55)).toBeNull();
  });

  it("handles rotation about the element centre", () => {
    const el = text({ text: "[[BFS]]", angle: Math.PI / 2 });
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    // a point on the unrotated glyphs, rotated by +90deg about the centre
    const px = el.x + 10;
    const py = el.y + 10;
    const rx = cx - (py - cy);
    const ry = cy + (px - cx);
    expect(hitTestTextLink([el], { x: rx, y: ry }, measure)).not.toBeNull();
    expect(hitTestTextLink([el], { x: px, y: py }, measure)).toBeNull();
  });

  it("ignores deleted and non-text elements and prefers the topmost", () => {
    const a = text({ id: "a", text: "[[A]]" });
    const b = text({ id: "b", text: "[[B]]" });
    expect(
      hitTestTextLink([a, b], { x: 110, y: 55 }, measure)?.element.id,
    ).toBe("b");
    expect(
      hitTestTextLink(
        [a, { ...b, isDeleted: true }],
        { x: 110, y: 55 },
        measure,
      )?.element.id,
    ).toBe("a");
    expect(
      hitTestTextLink(
        [{ ...a, type: "rectangle" }],
        { x: 110, y: 55 },
        measure,
      ),
    ).toBeNull();
  });

  it("converts client coordinates at any zoom and scroll", () => {
    const el = text({ text: "See [[BFS]] now" });
    const state = {
      zoom: { value: 2 },
      offsetLeft: 30,
      offsetTop: 40,
      scrollX: -50,
      scrollY: 10,
    };
    // scene (160, 60) -> client ((160-50)*2+30, (60+10)*2+40)
    const p = clientToScene({ clientX: 250, clientY: 180 }, state);
    expect(p).toEqual({ x: 160, y: 60 });
    expect(hitTestTextLink([el], p, measure)?.span.target).toBe("BFS");
  });
});

describe("shapeLinkAt", () => {
  it("returns the topmost linked element containing the point", () => {
    const a = {
      ...text({ id: "a", text: "", width: 50, height: 50 }),
      type: "rectangle",
      link: "[[A]]",
    };
    const b = {
      ...text({ id: "b", text: "", width: 50, height: 50 }),
      type: "rectangle",
      link: null,
    };
    expect(shapeLinkAt([a, b], { x: a.x + 1, y: a.y + 1 })?.id).toBe("a");
    expect(shapeLinkAt([a], { x: 0, y: 0 })).toBeNull();
  });
});
