import { describe, expect, it } from "vitest";

import { hitTestTextLink } from "./textLinkHitTest";

import type { TextLike } from "./textLinkHitTest";

/** A 500-line text element with a link on most lines. */
function bigElement(): TextLike {
  const lines = Array.from(
    { length: 500 },
    (_, i) =>
      `line ${i} with a [[Graphs/Note ${i}|label ${i}]] and some more words`,
  );
  const width = Math.max(...lines.map((l) => l.length)) * 10;
  return {
    id: "big",
    type: "text",
    x: 0,
    y: 0,
    width,
    height: lines.length * 25,
    angle: 0,
    fontSize: 20,
    fontFamily: 1,
    lineHeight: 1.25,
    textAlign: "center",
    text: lines.join("\n"),
  };
}

describe("text link hit-test performance (500-line element)", () => {
  it("stays within 1 ms p95 per click", () => {
    const el = bigElement();
    const others = Array.from({ length: 200 }, (_, i) => ({
      ...el,
      id: `o${i}`,
      text: "no links here",
      x: 5000 + i,
    }));
    const elements = [el, ...others];
    // Measuring is a canvas call in the app; model it with a small cost.
    const measure = (t: string) => t.length * 10;
    const times: number[] = [];
    for (let run = 0; run < 400; run++) {
      const y = ((run * 37) % 500) * 25 + 5;
      const s = performance.now();
      hitTestTextLink(elements, { x: 250 + (run % 90), y }, measure);
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.floor(q * (times.length - 1))];
    // eslint-disable-next-line no-console
    console.info(
      `link hit-test 500 lines: p50 ${p(0.5).toFixed(3)} ms, p95 ${p(
        0.95,
      ).toFixed(3)} ms, max ${times[times.length - 1].toFixed(3)} ms`,
    );
    expect(p(0.95)).toBeLessThan(1);
  });
});
