import { describe, expect, it } from "vitest";

import { linkAt } from "./linkBoxes";

import type { VersionedText } from "./linkBoxes";

const measure = (t: string) => t.length * 10;

describe("link box hit test performance", () => {
  it("500 linked texts + 2000 other elements: p95 < 0.2 ms per frame", () => {
    const elements: VersionedText[] = [];
    for (let i = 0; i < 2000; i++) {
      elements.push({
        id: `r${i}`,
        type: "rectangle",
        x: (i % 50) * 100,
        y: Math.floor(i / 50) * 100,
        width: 80,
        height: 80,
        angle: 0,
        text: "",
        fontSize: 20,
        fontFamily: 1,
        lineHeight: 1.25,
        textAlign: "left",
      });
    }
    for (let i = 0; i < 500; i++) {
      elements.push({
        id: `t${i}`,
        type: "text",
        x: (i % 25) * 200,
        y: Math.floor(i / 25) * 60,
        width: 180,
        height: 25,
        angle: i % 7 === 0 ? 0.3 : 0,
        fontSize: 20,
        fontFamily: 1,
        lineHeight: 1.25,
        textAlign: "left",
        text: `see [[Note ${i}]] ok`,
        version: 1,
      });
    }
    // Warm the cache the way the first hovers would.
    for (let i = 0; i < 500; i++) {
      linkAt(
        elements,
        { x: (i % 25) * 200 + 60, y: Math.floor(i / 25) * 60 + 10 },
        measure,
      );
    }
    const times: number[] = [];
    for (let run = 0; run < 1000; run++) {
      const i = (run * 37) % 500;
      const pt = {
        x: (i % 25) * 200 + 60 + (run % 5),
        y: Math.floor(i / 25) * 60 + 10,
      };
      const s = performance.now();
      linkAt(elements, pt, measure);
      times.push(performance.now() - s);
    }
    // Pointer over empty canvas: the whole scene is scanned, nothing hits.
    const misses: number[] = [];
    for (let run = 0; run < 1000; run++) {
      const s = performance.now();
      linkAt(elements, { x: -500 - run, y: -500 }, measure);
      misses.push(performance.now() - s);
    }
    misses.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.info(
      `link box hit test, full-scene miss: p95 ${misses[949].toFixed(4)} ms`,
    );
    expect(misses[949]).toBeLessThan(0.2);
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.floor(q * (times.length - 1))];
    // eslint-disable-next-line no-console
    console.info(
      `link box hit test 500 linked + 2000 other: p50 ${p(0.5).toFixed(
        4,
      )} ms, p95 ${p(0.95).toFixed(4)} ms, max ${times[
        times.length - 1
      ].toFixed(4)} ms`,
    );
    expect(p(0.95)).toBeLessThan(0.2);
  });
});
