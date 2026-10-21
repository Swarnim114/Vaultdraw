import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { FakePdfBridge } from "../tests/fakePdfBridge";

import { importSummary, usePdfImport } from "./usePdfImport";
import { DEFAULT_PDF_IMPORT_SETTINGS, PdfImportAborted } from "./types";

import type { PdfImportResult } from "./types";

const importPdf = vi.fn();
vi.mock("./importPdf", () => ({
  importPdf: (...a: unknown[]) => importPdf(...a),
}));

const api = {
  getSceneElements: () => [],
  getAppState: () => ({ pageSetup: null }),
  getFiles: () => ({}),
} as never;

const result = (over: Partial<PdfImportResult> = {}): PdfImportResult => ({
  imported: 3,
  skipped: [],
  truncated: 0,
  side: 1100,
  ...over,
});

let bridge: FakePdfBridge;
const notify = vi.fn();

const Host = ({ hasApi = true }: { hasApi?: boolean }) => {
  const pdf = usePdfImport({
    bridge,
    getApi: () => (hasApi ? api : undefined),
    getSettings: () => DEFAULT_PDF_IMPORT_SETTINGS,
    notify,
  });
  return (
    <div>
      <button onClick={() => void pdf.start()}>start</button>
      <button
        onClick={() =>
          void pdf.openFile(
            new File(["%PDF"], "dropped.pdf", { type: "application/pdf" }),
          )
        }
      >
        drop
      </button>
      {pdf.dialog}
    </div>
  );
};

beforeEach(() => {
  bridge = new FakePdfBridge();
  notify.mockReset();
  importPdf.mockReset();
});
afterEach(cleanup);

const open = async (name = "start") => {
  fireEvent.click(screen.getByText(name));
  await screen.findByRole("dialog", { name: "Import PDF" });
};

describe("usePdfImport", () => {
  it("pick -> dialog -> import -> notice (locked)", async () => {
    bridge.nextPick = bridge.makeDoc("a.pdf");
    render(<Host />);
    await open();
    importPdf.mockResolvedValue(result());
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledWith(
      "Imported 3 pages (locked; use Unlock all to edit them)",
      "info",
    );
    expect(importPdf.mock.calls[0][0]).toMatchObject({
      indices: [0, 1, 2],
      info: { name: "a.pdf" },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a cancelled pick does nothing", async () => {
    render(<Host />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it("dropped bytes open the same dialog", async () => {
    render(<Host />);
    await open("drop");
    expect(screen.getByText("dropped.pdf")).toBeTruthy();
  });

  it("closes the token when cancelled before importing", async () => {
    const info = bridge.makeDoc("a.pdf");
    bridge.nextPick = info;
    render(<Host />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(bridge.closes).toEqual([info.token]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the token on unmount while the dialog is open", async () => {
    const info = bridge.makeDoc("a.pdf");
    bridge.nextPick = info;
    const view = render(<Host />);
    await open();
    view.unmount();
    expect(bridge.closes).toEqual([info.token]);
  });

  it("Cancel during the import aborts the signal and shows no notice", async () => {
    bridge.nextPick = bridge.makeDoc("a.pdf");
    render(<Host />);
    await open();
    let signal!: AbortSignal;
    importPdf.mockImplementation(
      ({
        signal: s,
        onProgress,
      }: {
        signal: AbortSignal;
        onProgress: (p: unknown) => void;
      }) => {
        signal = s;
        onProgress({ done: 1, total: 3 });
        return new Promise((_, reject) =>
          s.addEventListener("abort", () => reject(new PdfImportAborted())),
        );
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(signal.aborted).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ["PDF_ENCRYPTED", "This PDF is password-protected."],
    ["PDF_INVALID", "Not a readable PDF."],
    ["PDF_BAD_TOKEN", "Couldn't import the PDF."],
  ])("maps %s to a friendly error", async (code, message) => {
    bridge.openError = code;
    render(<Host />);
    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(message, "error"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("password-protected PDF", () => {
    const prompt = async () => {
      bridge.password = "s3cret";
      bridge.nextPick = bridge.makeDoc("locked.pdf");
      render(<Host />);
      await open();
      return screen.getByLabelText("Password") as HTMLInputElement;
    };

    it("asks for the password, rejects a wrong one, then shows the page options", async () => {
      const field = await prompt();
      expect(field.type).toBe("password");
      expect(screen.getByText(/password-protected/)).toBeTruthy();
      expect(document.activeElement).toBe(field);
      fireEvent.change(field, { target: { value: "nope" } });
      fireEvent.submit(field.closest("form")!);
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /Wrong password/,
      );
      expect(screen.getByLabelText("Password")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "s3cret" },
      });
      fireEvent.submit(field.closest("form")!);
      await screen.findByText(/3 pages below the drawing/);
      expect(screen.queryByLabelText("Password")).toBeNull();
      expect(bridge.unlockAttempts).toEqual(["nope", "s3cret"]);
      expect(notify).not.toHaveBeenCalled();
    });

    it("Cancel and Escape close the locked document without importing", async () => {
      await prompt();
      fireEvent.keyDown(screen.getByLabelText("Password"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(bridge.closes).toHaveLength(1);
      expect(importPdf).not.toHaveBeenCalled();
    });

    it("an empty password is not submitted", async () => {
      const field = await prompt();
      fireEvent.submit(field.closest("form")!);
      await act(async () => {});
      expect(bridge.unlockAttempts).toEqual([]);
    });
  });

  it("does nothing without an open drawing", async () => {
    bridge.nextPick = bridge.makeDoc("a.pdf");
    render(<Host hasApi={false} />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("importSummary", () => {
  it("covers locked, unlocked, truncated and skipped pages", () => {
    const s = DEFAULT_PDF_IMPORT_SETTINGS;
    expect(importSummary(result({ imported: 1 }), s)).toBe(
      "Imported 1 page (locked; use Unlock all to edit them)",
    );
    expect(importSummary(result(), { ...s, lockPages: false })).toBe(
      "Imported 3 pages",
    );
    expect(
      importSummary(result({ truncated: 37, skipped: [1, 4] }), {
        ...s,
        lockPages: false,
      }),
    ).toBe(
      "Imported 3 pages. 37 pages not imported: the drawing reached its size limit. 2 pages could not be rendered (2, 5)",
    );
  });
});
