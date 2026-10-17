import { describe, expect, it } from "vitest";

import { FakePdfBridge, makePages } from "./fakePdfBridge";

describe("FakePdfBridge", () => {
  it("picks, renders, records and rejects after close", async () => {
    const b = new FakePdfBridge({ pages: makePages(2), failPages: [1] });
    expect(await b.pick()).toBeNull();
    const info = b.makeDoc("a.pdf");
    b.nextPick = info;
    expect(await b.pick()).toBe(info);
    const opts = { maxSide: 400, format: "jpeg" as const, quality: 0.8 };
    expect((await b.renderPage(info.token, 0, opts)).length).toBeGreaterThan(0);
    await expect(b.renderPage(info.token, 1, opts)).rejects.toMatchObject({
      code: "PDF_PAGE_FAILED",
    });
    await b.close(info.token);
    await expect(b.renderPage(info.token, 0, opts)).rejects.toMatchObject({
      code: "PDF_BAD_TOKEN",
    });
    expect(b.renders).toHaveLength(3);
    expect(b.closes).toEqual([info.token]);
  });

  it("fails to open with the configured code", async () => {
    const b = new FakePdfBridge({ openError: "PDF_ENCRYPTED" });
    await expect(b.openBytes("x.pdf", new Uint8Array())).rejects.toMatchObject({
      code: "PDF_ENCRYPTED",
    });
  });
});
