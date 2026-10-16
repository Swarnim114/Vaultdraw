/** Report-only: `#` keystroke -> rows, 2,000 distinct tags. */
import { describe, it } from "vitest";

import { rankTags } from "./tagRank";

import type { TagCount } from "../../tags/types";

const WORDS = ["algo", "graph", "dp", "tree", "work", "todo", "idea", "arch"];
const TAGS: TagCount[] = Array.from({ length: 2000 }, (_, i) => {
  const a = WORDS[i % 8];
  const b = WORDS[(i * 7) % 8];
  const display = i % 3 ? `${a}${i}` : `${a}/${b}${i}`;
  return { tag: display.toLowerCase(), display, count: (i * 31) % 97 };
}).sort((x, y) => (x.tag < y.tag ? -1 : 1));

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)];

describe("tag rank bench", () => {
  it("reports p50/p95", () => {
    const typing = ["", "a", "al", "alg", "gr", "work/", "zz", "dp1", "ea"];
    for (let w = 0; w < 50; w++) {
      typing.forEach((q) => rankTags(TAGS, q, 8));
    }
    const times: number[] = [];
    for (let r = 0; r < 200; r++) {
      for (const q of typing) {
        const t = performance.now();
        rankTags(TAGS, q, 8);
        times.push(performance.now() - t);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `tagRank 2000 tags: p50 ${pct(times, 0.5).toFixed(3)} ms, p95 ${pct(
        times,
        0.95,
      ).toFixed(3)} ms`,
    );
  });
});
