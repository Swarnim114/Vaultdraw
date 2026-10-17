import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { makePages } from "../tests/fakePdfBridge";

import PdfImportDialog from "./PdfImportDialog";
import { DEFAULT_PDF_IMPORT_SETTINGS } from "./types";

import type { PdfInfo } from "./types";

const info = (n: number): PdfInfo => ({
  token: 1,
  name: "notes.pdf",
  pageCount: n,
  pages: makePages(n),
  byteSize: 1000,
});

const api = (pageSetup: unknown = null, bytes = 0) =>
  ({
    getSceneElements: () => [],
    getAppState: () => ({ pageSetup }),
    getFiles: () =>
      bytes ? { a: { dataURL: "x".repeat(bytes) } } : ({} as never),
  } as never);

const setup = (
  overrides: Partial<Parameters<typeof PdfImportDialog>[0]> = {},
) => {
  const onImport = vi.fn();
  const onCancel = vi.fn();
  render(
    <PdfImportDialog
      info={info(10)}
      settings={DEFAULT_PDF_IMPORT_SETTINGS}
      api={api()}
      progress={null}
      onImport={onImport}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onImport, onCancel };
};

afterEach(cleanup);

describe("PdfImportDialog", () => {
  it("shows the file, estimate, placement and the dark-mode note", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Import PDF" })).toBeTruthy();
    expect(screen.getByText("notes.pdf")).toBeTruthy();
    expect(screen.getByText(/10 pages below the drawing/)).toBeTruthy();
    expect(screen.getByText(/rendered at \d+ px/)).toBeTruthy();
    expect(screen.getByText("Pages stay white in dark mode.")).toBeTruthy();
  });

  it("imports all pages on Enter and the Import button", () => {
    const { onImport } = setup();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onImport).toHaveBeenCalledWith([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onImport).toHaveBeenCalledTimes(2);
  });

  it("validates the range live and blocks the import", () => {
    const { onImport } = setup();
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "3-99" } });
    expect(screen.getByRole("alert").textContent).toMatch(/10 pages/);
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onImport).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "2-4, 8" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onImport).toHaveBeenCalledWith([1, 2, 3, 7]);
  });

  it("warns above warnPages", () => {
    setup({
      info: info(12),
      settings: { ...DEFAULT_PDF_IMPORT_SETTINGS, warnPages: 5 },
    });
    expect(screen.getByText(/12 pages is a lot/)).toBeTruthy();
  });

  it("warns when only some pages fit the drawing size limit", () => {
    setup({ api: api(null, 30 * 1024 * 1024) });
    expect(
      screen.getByText(/Only 0 of 10 pages fit in this drawing/),
    ).toBeTruthy();
  });

  it("caps the import at the per-import page limit", () => {
    setup({ info: info(250) });
    expect(
      screen.getByText(/Only 200 of 250 pages can be imported/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
  });

  it("page mode: shows the target pages and clamps to the pages left", () => {
    const pageSetup = {
      enabled: true,
      layout: "separate",
      size: "a4",
      orientation: "portrait",
      width: 794,
      height: 1123,
      pageCount: 1,
      paperTheme: "normal",
    };
    setup({ api: api(pageSetup), info: info(3) });
    expect(screen.getByText(/on pages 1–3/)).toBeTruthy();
  });

  it("Escape and Cancel cancel", () => {
    const { onCancel } = setup();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("while importing: progress bar, no Import button, Cancel aborts", () => {
    const { onCancel, onImport } = setup({
      progress: { done: 2, total: 10 },
    });
    expect(screen.getByText("Rendering page 3 of 10")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
