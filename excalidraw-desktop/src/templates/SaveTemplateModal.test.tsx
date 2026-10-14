import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SaveTemplateModal } from "./SaveTemplateModal";

const setup = (props = {}) => {
  const onSave = vi.fn(async () => {});
  const onCancel = vi.fn();
  render(
    <SaveTemplateModal
      defaultName="Lecture.excalidraw"
      ownerDocument={document}
      onSave={onSave}
      onCancel={onCancel}
      readOnlyVault={false}
      {...props}
    />,
  );
  return { onSave, onCancel };
};

describe("SaveTemplateModal", () => {
  it("focuses the name and submits with Enter", async () => {
    const { onSave } = setup();
    const input = screen.getByLabelText("Template name") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Lecture");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("Lecture", "vault"),
    );
  });

  it("saves globally when chosen", async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByLabelText("All vaults (global)"));
    fireEvent.submit(screen.getByLabelText("Template name").closest("form")!);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("Lecture", "global"),
    );
  });

  it("cancels on Escape", () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables the vault scope when read-only", () => {
    setup({ readOnlyVault: true });
    expect(
      (screen.getByLabelText(/This vault/) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("All vaults (global)") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("shows validation and save errors", async () => {
    const { onSave } = setup({
      onSave: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    void onSave;
    const input = screen.getByLabelText("Template name");
    fireEvent.change(input, { target: { value: "a/b" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText(/slashes/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "ok" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("disk full")).toBeTruthy();
  });
});
