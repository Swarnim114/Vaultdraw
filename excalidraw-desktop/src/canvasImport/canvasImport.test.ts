import { describe, expect, it, vi } from "vitest";

import { COMMANDS, getCommand } from "../commands/commands";
import { appCommandHandlers } from "../commands/useAppCommands";

import {
  IMPORT_ACCEPT,
  isPdfFile,
  planImport,
  skippedMessage,
} from "./importFiles";
import { importPickedFiles } from "./useCanvasImport";
import {
  IMPORT_FILE_COMMAND_ID,
  IMPORT_FILE_MENU_ITEM,
  importFileMenuItems,
} from "./useCanvasImportMenu";

const file = (name: string, type: string) => new File(["x"], name, { type });
const pdf = (name = "a.pdf") => file(name, "application/pdf");
const png = (name = "a.png") => file(name, "image/png");

describe("planImport", () => {
  it("routes the first PDF to the dialog and images to insertion", () => {
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    const img = png();
    const jpg = file("c.jpg", "image/jpeg");
    const txt = file("notes.txt", "text/plain");
    expect(planImport([img, a, b, jpg, txt])).toEqual({
      pdf: a,
      images: [img, jpg],
      skipped: [b, txt],
    });
  });

  it("recognises a PDF by extension when the type is missing", () => {
    expect(isPdfFile(file("scan.PDF", ""))).toBe(true);
    expect(isPdfFile(png())).toBe(false);
  });

  it("the picker accepts PDFs and the editor's image types", () => {
    for (const t of ["application/pdf", ".pdf", "image/png", "image/svg+xml"]) {
      expect(IMPORT_ACCEPT.split(",")).toContain(t);
    }
  });

  it("names skipped files, nothing when none", () => {
    expect(skippedMessage([])).toBeNull();
    expect(skippedMessage([file("x.txt", "text/plain")])).toContain("x.txt");
  });
});

describe("importPickedFiles", () => {
  const setup = () => {
    const api = { insertImages: vi.fn(async () => {}) };
    const openPdf = vi.fn();
    const notify = vi.fn();
    return {
      api,
      openPdf,
      notify,
      options: { getApi: () => api as never, openPdf, notify },
    };
  };

  it("inserts images at the point and opens the PDF dialog", async () => {
    const s = setup();
    const img = png();
    const doc = pdf();
    await importPickedFiles([img, doc], { x: 10, y: 20 }, s.options);
    expect(s.api.insertImages).toHaveBeenCalledWith([img], { x: 10, y: 20 });
    expect(s.openPdf).toHaveBeenCalledWith(doc);
    expect(s.notify).not.toHaveBeenCalled();
  });

  it("does nothing on cancel (no files) or without an open drawing", async () => {
    const s = setup();
    await importPickedFiles([], undefined, s.options);
    await importPickedFiles([png()], undefined, {
      ...s.options,
      getApi: () => undefined,
    });
    expect(s.api.insertImages).not.toHaveBeenCalled();
    expect(s.openPdf).not.toHaveBeenCalled();
  });

  it("tells the user about files it can't import", async () => {
    const s = setup();
    await importPickedFiles(
      [file("a.zip", "application/zip")],
      undefined,
      s.options,
    );
    expect(s.notify).toHaveBeenCalledWith(expect.stringContaining("a.zip"));
    expect(s.api.insertImages).not.toHaveBeenCalled();
  });
});

describe("canvas menu item and command", () => {
  it("offers Import file… with the command's shortcut, only when enabled", () => {
    const onImport = vi.fn();
    const [item] = importFileMenuItems({ x: 1, y: 2 }, onImport, true, "Cmd+I");
    expect(item).toMatchObject({
      name: IMPORT_FILE_MENU_ITEM,
      label: "Import file…",
      shortcut: "Cmd+I",
    });
    item.onSelect();
    expect(onImport).toHaveBeenCalledWith({ x: 1, y: 2 });
    expect(importFileMenuItems({ x: 0, y: 0 }, onImport, false, "")).toEqual(
      [],
    );
    expect(importFileMenuItems({ x: 0, y: 0 }, undefined, true, "")).toEqual(
      [],
    );
  });

  it("is a rebindable palette command for a writable open drawing", () => {
    expect(getCommand(IMPORT_FILE_COMMAND_ID)).toMatchObject({
      title: "Import: File…",
      category: "File",
      when: ["drawingOpen", "writable"],
      keys: { default: [] },
    });
    expect(
      COMMANDS.filter((c) => c.id === IMPORT_FILE_COMMAND_ID),
    ).toHaveLength(1);
    const importFile = vi.fn();
    appCommandHandlers({ importFile } as never)[IMPORT_FILE_COMMAND_ID]!();
    expect(importFile).toHaveBeenCalledOnce();
  });
});
