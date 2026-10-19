import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";

import { useFormulaCommands } from "./useFormulaCommands";

vi.mock("./FormulaDialog", () => ({ default: () => null }));

const formulaEl = (extra: object = {}) =>
  ({
    id: "f",
    type: "image",
    locked: false,
    customData: {
      latex: {
        v: 1,
        source: "x",
        display: true,
        color: "#000",
        width: 10,
        height: 5,
      },
    },
    ...extra,
  } as any);

const makeRef = (appState: object = {}, scene: any[] = [formulaEl()]) => ({
  current: {
    getAppState: () => ({
      viewModeEnabled: false,
      selectedElementIds: { f: true },
      currentItemStrokeColor: "#1e1e1e",
      ...appState,
    }),
    getSceneElements: () => scene,
  } as any,
});

describe("useFormulaCommands.onImageEdit", () => {
  it("opens the dialog for an unlocked formula", async () => {
    const { result } = renderHook(() =>
      useFormulaCommands({ apiRef: makeRef() }),
    );
    let handled = false;
    act(() => {
      handled = result.current.onImageEdit(formulaEl());
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(result.current.dialog).not.toBeNull());
  });

  it("falls through in view mode, when locked, or for plain images", () => {
    const view = renderHook(() =>
      useFormulaCommands({ apiRef: makeRef({ viewModeEnabled: true }) }),
    );
    expect(view.result.current.onImageEdit(formulaEl())).toBe(false);
    const { result } = renderHook(() =>
      useFormulaCommands({ apiRef: makeRef() }),
    );
    expect(result.current.onImageEdit(formulaEl({ locked: true }))).toBe(false);
    expect(result.current.onImageEdit(formulaEl({ customData: {} }))).toBe(
      false,
    );
    const ro = renderHook(() =>
      useFormulaCommands({ apiRef: makeRef(), readOnly: true }),
    );
    expect(ro.result.current.onImageEdit(formulaEl())).toBe(false);
  });

  it("onImageEdit is stable and formula.edit no-ops without a formula", () => {
    const apiRef = makeRef({ selectedElementIds: {} });
    const { result, rerender } = renderHook(() =>
      useFormulaCommands({ apiRef }),
    );
    const first = result.current.onImageEdit;
    getRegisteredHandler("formula.edit")?.();
    rerender();
    expect(result.current.onImageEdit).toBe(first);
    expect(result.current.dialog).toBeNull();
  });
});
