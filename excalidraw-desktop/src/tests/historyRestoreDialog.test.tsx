import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RestoreDialog } from "../history/RestoreDialog";

import type { ReplaceRefusal } from "../history/restore";

const setup = (replaceRefusal: ReplaceRefusal = null) => {
  const handlers = {
    onReplace: vi.fn(),
    onCopy: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <RestoreDialog
      versionLabel="14:03"
      replaceRefusal={replaceRefusal}
      ownerDocument={document}
      {...handlers}
    />,
  );
  return handlers;
};

const replaceBtn = () =>
  screen.getByRole("button", { name: "Replace current drawing" });
const copyBtn = () => screen.getByRole("button", { name: "Restore as a copy" });

describe("RestoreDialog", () => {
  it("titles the version and focuses Replace when allowed", () => {
    setup();
    expect(screen.getByText("Restore 14:03?")).toBeInTheDocument();
    expect(replaceBtn()).toHaveFocus();
    expect(replaceBtn()).toBeEnabled();
  });

  it("wires the three outcomes", () => {
    const h = setup();
    fireEvent.click(replaceBtn());
    fireEvent.click(copyBtn());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onReplace).toHaveBeenCalledTimes(1);
    expect(h.onCopy).toHaveBeenCalledTimes(1);
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels", () => {
    const h = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["conflict", "The drawing has unsaved conflicting changes"],
    ["deleted", "The drawing was deleted"],
    ["read-only", "This vault is read-only"],
  ] as const)(
    "%s disables Replace with the reason and focuses the copy button",
    (refusal, text) => {
      const h = setup(refusal);
      expect(replaceBtn()).toBeDisabled();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(copyBtn()).toHaveFocus();
      fireEvent.click(replaceBtn());
      expect(h.onReplace).not.toHaveBeenCalled();
    },
  );
});
