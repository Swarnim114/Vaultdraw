/** Report-only: Tags pane render and sort toggle with 2,000 tags. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { describe, it } from "vitest";

import { TagsPanel } from "../components/tags/TagsPanel";

const tags = Array.from({ length: 2000 }, (_, i) => ({
  tag: `g${i % 40}/t${i}`,
  display: `G${i % 40}/t${i}`,
  count: (i % 17) + 1,
}));

describe("tags pane bench (report only)", () => {
  it("2k tags", () => {
    const run = (fn: () => void) => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    };
    const mount: number[] = [];
    const sort: number[] = [];
    for (let i = 0; i < 7; i++) {
      mount.push(
        run(() => {
          render(<TagsPanel tags={tags} query="" onQueryChange={() => {}} />);
        }),
      );
      sort.push(
        run(() =>
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: /^Sort tags/ }));
          }),
        ),
      );
      cleanup();
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    // eslint-disable-next-line no-console
    console.log(
      `tags pane 2000 tags: mount p50 ${med(mount).toFixed(
        1,
      )} ms, sort toggle p50 ${med(sort).toFixed(1)} ms`,
    );
  });
});
