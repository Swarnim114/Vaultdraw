import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplatePicker } from "../templates/TemplatePicker";

import type { TemplatePickerProps } from "../templates/TemplatePicker";
import type { TemplateEntry } from "../templates/types";

const entry = (
  name: string,
  source: "vault" | "global" = "vault",
): TemplateEntry => ({
  source,
  path:
    source === "vault" ? `Templates/${name}.excalidraw` : `${name}.excalidraw`,
  name,
  modifiedAt: 1000,
  size: 10,
});

let observed: Element[] = [];
let trigger: (el: Element, isIntersecting: boolean) => void = () => {};

beforeEach(() => {
  observed = [];
  class IO {
    cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      trigger = (el, isIntersecting) =>
        this.cb(
          [{ target: el, isIntersecting } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const setup = (over: Partial<TemplatePickerProps> = {}) => {
  const props: TemplatePickerProps = {
    ownerDocument: document,
    vaultName: "Notes",
    vaultTemplates: [entry("Alpha"), entry("Beta")],
    globalTemplates: [entry("Gamma", "global")],
    loading: false,
    templatesFolder: "Templates",
    renderThumbnail: vi.fn(async () => "data:image/svg+xml,x"),
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<TemplatePicker {...props} />);
  return props;
};

const input = () => screen.getByRole("combobox");
const activeName = () => {
  const id = input().getAttribute("aria-activedescendant")!;
  return document.getElementById(id)!.textContent;
};

describe("TemplatePicker", () => {
  it("renders groups, focuses the input and navigates by keyboard", () => {
    const p = setup();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(input());
    expect(screen.getByText("This vault (Templates/)")).toBeTruthy();
    expect(screen.getByText("All vaults")).toBeTruthy();
    expect(activeName()).toContain("Alpha");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(activeName()).toContain("Beta");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(activeName()).toContain("Gamma");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(activeName()).toContain("Alpha");
    fireEvent.keyDown(input(), { key: "End" });
    expect(activeName()).toContain("Gamma");
    fireEvent.keyDown(input(), { key: "Home" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(activeName()).toContain("Gamma");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(p.onPick).toHaveBeenCalledWith(p.globalTemplates[0]);
  });

  it("filters live and resets the selection", async () => {
    const p = setup();
    fireEvent.change(input(), { target: { value: "bet" } });
    await act(async () => {});
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(p.onPick).toHaveBeenCalledWith(p.vaultTemplates[1]);
    fireEvent.change(input(), { target: { value: "zzz" } });
    await act(async () => {});
    expect(screen.getByText(/No templates match/)).toBeTruthy();
  });

  it("picks on click and closes on Escape without propagating", () => {
    const p = setup();
    fireEvent.click(screen.getByText("Beta"));
    expect(p.onPick).toHaveBeenCalledWith(p.vaultTemplates[1]);
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    fireEvent.keyDown(input(), { key: "Escape" });
    document.body.removeEventListener("keydown", outer);
    expect(p.onClose).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it("hover highlights a row", () => {
    setup();
    fireEvent.mouseMove(screen.getByText("Gamma"));
    expect(activeName()).toContain("Gamma");
  });

  it("shows an optional Blank drawing row first", () => {
    const onBlank = vi.fn();
    setup({ onBlank });
    expect(activeName()).toContain("Blank drawing");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onBlank).toHaveBeenCalled();
  });

  it("shows the empty state with a reveal button", () => {
    const onRevealGlobal = vi.fn();
    setup({ vaultTemplates: [], globalTemplates: [], onRevealGlobal });
    expect(screen.getByText("No templates yet")).toBeTruthy();
    expect(screen.getByText("Templates/")).toBeTruthy();
    fireEvent.click(screen.getByText("Open global templates folder"));
    expect(onRevealGlobal).toHaveBeenCalled();
  });

  it("requests thumbnails only for visible rows and cancels on leave", async () => {
    const cancelThumbnail = vi.fn();
    const p = setup({
      cancelThumbnail,
      renderThumbnail: vi.fn(() => new Promise<string | null>(() => {})),
    });
    expect(p.renderThumbnail).not.toHaveBeenCalled();
    const rows = observed.filter((el) => el.getAttribute("role") === "option");
    expect(rows).toHaveLength(3);
    act(() => trigger(rows[0], true));
    expect(p.renderThumbnail).toHaveBeenCalledTimes(1);
    expect(p.renderThumbnail).toHaveBeenCalledWith(p.vaultTemplates[0]);
    act(() => trigger(rows[0], false));
    expect(cancelThumbnail).toHaveBeenCalledWith(p.vaultTemplates[0]);
  });

  it("renders the thumbnail image when loaded", async () => {
    setup();
    const row = observed.find((el) => el.textContent?.includes("Alpha"))!;
    await act(async () => trigger(row, true));
    expect(row.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/svg+xml,x",
    );
  });
});
