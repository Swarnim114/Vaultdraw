import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VaultEditor } from "../editor/VaultEditor";
import { getDefaultBackgroundPattern } from "../vault/paperDefaults";

import { BLANK_SCENE } from "./fixtures";

const mount = async (props: { readOnly?: boolean; json?: string } = {}) => {
  const onChange = vi.fn();
  const view = render(
    <VaultEditor
      documentId={`doc-paper-${Math.random()}`}
      initialSource={{ json: props.json ?? BLANK_SCENE }}
      name="paper.excalidraw"
      onChange={onChange}
      readOnly={props.readOnly}
    />,
  );
  await waitFor(() => {
    if (!view.container.querySelector("canvas.interactive")) {
      throw new Error("canvas not ready");
    }
    if ((window as any).h?.state?.isLoading) {
      throw new Error("still loading");
    }
  });
  return { onChange, ...view };
};

const openMenu = async () =>
  act(async () => {
    fireEvent.click(screen.getByTestId("main-menu-trigger"));
  });

describe("Paper menu item and dialog", () => {
  beforeEach(() => window.localStorage.clear());

  it("switches the drawing's paper and autosaves it", async () => {
    const { onChange } = await mount();
    await openMenu();
    expect(screen.getByLabelText("Plain")).toBeChecked();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Dots"));
    });
    await waitFor(() => expect(screen.getByLabelText("Dots")).toBeChecked());
    expect((window as any).h.state.viewBackgroundPattern.type).toBe("dots");
    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
    const saved = JSON.parse(onChange.mock.calls.at(-1)![0]);
    expect(saved.appState.viewBackgroundPattern.type).toBe("dots");
  });

  it("opens the dialog, edits and uses app default; Escape closes", async () => {
    await mount();
    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText("Paper settings…"));
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Paper settings",
    });
    expect(dialog).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Grid"));
    });
    await waitFor(() =>
      expect((window as any).h.state.viewBackgroundPattern?.type).toBe("grid"),
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Make app default"));
    });
    expect(getDefaultBackgroundPattern()?.type).toBe("grid");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Plain"));
    });
    await waitFor(() =>
      expect((window as any).h.state.viewBackgroundPattern).toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Use app default"));
    });
    await waitFor(() =>
      expect((window as any).h.state.viewBackgroundPattern?.type).toBe("grid"),
    );
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Paper settings" })).toBeNull();
  });

  it("is hidden in read-only mode", async () => {
    await mount({ readOnly: true });
    await openMenu();
    expect(screen.queryByText("Paper settings…")).toBeNull();
  });
});
