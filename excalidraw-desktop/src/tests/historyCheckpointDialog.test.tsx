import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CheckpointDialog } from "../history/CheckpointDialog";

const setup = (onSave = vi.fn().mockResolvedValue(undefined)) => {
  const onCancel = vi.fn();
  render(
    <CheckpointDialog
      onSave={onSave}
      onCancel={onCancel}
      ownerDocument={document}
    />,
  );
  return { onSave, onCancel };
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () =>
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key: k, ...init });
const saveButton = () =>
  screen.getByRole("button", { name: /Save checkpoint|Saving/ });

describe("CheckpointDialog", () => {
  it("focuses the name and requires it", () => {
    const { onSave } = setup();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(saveButton()).toBeDisabled();
    submit();
    expect(onSave).not.toHaveBeenCalled();
    type("Name", "   ");
    expect(saveButton()).toBeDisabled();
    submit();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("submitting (Enter in the name field) saves the trimmed name and note", () => {
    const { onSave } = setup();
    type("Name", "  Before refactor  ");
    type("Note (optional)", "line 1\nline 2");
    submit();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("Before refactor", "line 1\nline 2");
  });

  it("Mod+Enter in the note saves, plain Enter does not", async () => {
    const { onSave } = setup();
    type("Name", "n");
    type("Note (optional)", "a\nb");
    const note = screen.getByLabelText("Note (optional)");
    fireEvent.keyDown(note, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(note, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("n", "a\nb"));
  });

  it("saves once even if submitted twice quickly", () => {
    let finish: () => void = () => {};
    const onSave = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    setup(onSave);
    type("Name", "n");
    submit();
    submit();
    expect(onSave).toHaveBeenCalledTimes(1);
    finish();
  });

  it("limits the name to 120 and the note to 2000 characters", () => {
    setup();
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Note (optional)")).toHaveAttribute(
      "maxlength",
      "2000",
    );
  });

  it("Escape and the Cancel button cancel", () => {
    const { onCancel } = setup();
    key("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows a save error inline and allows retry", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce({ code: "HISTORY_OFF", message: "History is off" })
      .mockResolvedValue(undefined);
    setup(onSave);
    type("Name", "n");
    submit();
    expect(await screen.findByText(/History is off/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).not.toBeDisabled(),
    );
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it("traps Tab inside the dialog", () => {
    setup();
    type("Name", "n");
    saveButton().focus();
    key("Tab");
    expect(screen.getByLabelText("Close")).toHaveFocus();
    key("Tab", { shiftKey: true });
    expect(saveButton()).toHaveFocus();
  });
});
