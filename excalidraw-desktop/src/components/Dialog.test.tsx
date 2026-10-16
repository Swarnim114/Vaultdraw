import { useState } from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createToastStore } from "../toasts/toastStore";

import { ConfirmModal } from "./ConfirmModal";
import { Dialog } from "./Dialog";
import { MoveModal } from "./MoveModal";
import { Toasts } from "./Toasts";

afterEach(() => {
  vi.useRealTimers();
});

describe("Dialog", () => {
  it("closes on Escape wherever focus is (body, input, outside the dialog)", () => {
    const onClose = vi.fn();
    render(
      <>
        <input aria-label="elsewhere" />
        <Dialog title="T" titleId="t" onClose={onClose}>
          <input aria-label="inside" />
        </Dialog>
      </>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("inside"), { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("elsewhere"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("is not closed by other keys, and stops listening when unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Dialog title="T" titleId="t" onClose={onClose}>
        body
      </Dialog>,
    );
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape and the backdrop while busy", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="T" titleId="t" onClose={onClose} busy>
        body
      </Dialog>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click but not on a click inside", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="T" titleId="t" onClose={onClose}>
        <span>inside</span>
      </Dialog>,
    );
    fireEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog focus restore", () => {
  const Host = ({ open }: { open: boolean }) => (
    <>
      <button type="button" data-testid="row">
        row
      </button>
      {open && (
        <Dialog title="T" titleId="t" onClose={() => {}}>
          <input aria-label="inside" autoFocus />
        </Dialog>
      )}
    </>
  );

  it("returns focus to the element that had it when the dialog opened", () => {
    const { rerender } = render(<Host open={false} />);
    screen.getByTestId("row").focus();
    rerender(<Host open />);
    expect(screen.getByLabelText("inside")).toHaveFocus();
    rerender(<Host open={false} />);
    expect(screen.getByTestId("row")).toHaveFocus();
  });

  it("restores focus after Escape closes the dialog", () => {
    const Stateful = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="row" onClick={() => setOpen(true)}>
            row
          </button>
          {open && (
            <Dialog title="T" titleId="t" onClose={() => setOpen(false)}>
              <input aria-label="inside" autoFocus />
            </Dialog>
          )}
        </>
      );
    };
    render(<Stateful />);
    const row = screen.getByTestId("row");
    row.focus();
    fireEvent.click(row);
    expect(screen.getByLabelText("inside")).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(row).toHaveFocus();
  });

  it("leaves focus alone when nothing was focused (body) or the opener is gone", () => {
    const { rerender } = render(<Host open={false} />);
    rerender(<Host open />);
    rerender(<Host open={false} />);
    expect(document.body).toHaveFocus();

    const gone = render(
      <>
        <button type="button">temp</button>
      </>,
    );
    gone.container.querySelector("button")!.focus();
    const dlg = render(
      <Dialog title="T" titleId="t2" onClose={() => {}}>
        x
      </Dialog>,
    );
    gone.unmount();
    dlg.unmount();
    expect(document.body).toHaveFocus();
  });
});

describe("ConfirmModal", () => {
  it("focuses Cancel when destructive and Confirm otherwise", () => {
    const { rerender } = render(
      <ConfirmModal
        title="T"
        message="m"
        isDanger
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    rerender(
      <ConfirmModal
        title="T"
        message="m"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
  });
});

describe("MoveModal keyboard", () => {
  const FOLDERS = ["", "A", "A/Inner", "B"];
  const setup = () => {
    const onMove = vi.fn();
    render(
      <MoveModal
        sourcePath="Drawing.excalidraw"
        sourceKind="drawing"
        folders={FOLDERS}
        onMove={onMove}
        onCancel={() => {}}
      />,
    );
    return { onMove, input: screen.getByLabelText("Filter folders") };
  };

  it("moves into the highlighted folder with Enter (root first)", () => {
    const { onMove, input } = setup();
    // The drawing already lives in the root: not allowed.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onMove).toHaveBeenCalledWith("A");
  });

  it("expands with ArrowRight, steps in, and collapses with ArrowLeft", () => {
    const { onMove, input } = setup();
    expect(screen.queryByRole("treeitem", { name: "Inner" })).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getByRole("treeitem", { name: "Inner" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getByRole("treeitem", { name: "Inner" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Left: out to the parent, then collapse it.
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(screen.getByRole("treeitem", { name: "A" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(screen.queryByRole("treeitem", { name: "Inner" })).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("type-ahead filters and Enter moves into the first match", () => {
    const { onMove, input } = setup();
    fireEvent.change(input, { target: { value: "inn" } });
    expect(screen.getAllByRole("treeitem").map((n) => n.textContent)).toEqual([
      "Vault root",
      "A",
      "Inner",
    ]);
    // The selection already sits on the match, not its ancestor.
    expect(screen.getByRole("treeitem", { name: "Inner" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onMove).toHaveBeenCalledWith("A/Inner");
  });
});

describe("Toasts host", () => {
  it("renders nothing when empty and sets no timer", () => {
    vi.useFakeTimers();
    const store = createToastStore(() => Date.now());
    const { container } = render(<Toasts store={store} />);
    expect(container).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a toast, runs Undo once, and expires on time", () => {
    vi.useFakeTimers();
    const store = createToastStore(() => Date.now());
    const run = vi.fn();
    render(<Toasts store={store} />);
    act(() => store.push({ message: "Moved", action: { label: "Undo", run } }));
    expect(screen.getByRole("status")).toHaveTextContent("Moved");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => store.push({ message: "Saved" }));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5001);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dismisses a focused toast with Escape", () => {
    const store = createToastStore();
    render(<Toasts store={store} />);
    act(() => store.push({ message: "Hello" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Dismiss notification" }),
      {
        key: "Escape",
      },
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
