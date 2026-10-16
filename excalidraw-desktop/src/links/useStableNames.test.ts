import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { drawingNames, useStableNames } from "./useAppLinks";

import type { VaultEntry } from "../vault/types";

const entry = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path,
  kind,
  modifiedAt: 0,
  size: 0,
});

describe("useStableNames", () => {
  it("lists sorted drawing paths only", () => {
    expect(
      drawingNames([
        entry("b", "drawing"),
        entry("d", "folder"),
        entry("a", "drawing"),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("keeps identity while the content is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ entries }) => useStableNames(entries, true),
      { initialProps: { entries: [entry("a", "drawing")] } },
    );
    const first = result.current;
    rerender({ entries: [entry("a", "drawing"), entry("f", "folder")] });
    expect(result.current).toBe(first);
    rerender({ entries: [entry("a", "drawing"), entry("b", "drawing")] });
    expect(result.current).toEqual(["a", "b"]);
  });

  it("skips the work when disabled", () => {
    const { result } = renderHook(() =>
      useStableNames([entry("a", "drawing")], false),
    );
    expect(result.current).toEqual([]);
  });
});
