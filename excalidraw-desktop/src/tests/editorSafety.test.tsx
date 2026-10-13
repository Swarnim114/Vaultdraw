import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@testing-library/react";

import { VaultEditor } from "../editor/VaultEditor";

import { BLANK_SCENE } from "./fixtures";

describe("VaultEditor safety and drop guard", () => {
  it("intercepts and prevents non-shift drops of drawing files to prevent accidental scene replacement", () => {
    const onChange = vi.fn();
    const { container } = render(
      <VaultEditor
        documentId="doc-safety-1"
        initialJson={BLANK_SCENE}
        name="test.excalidraw"
        onChange={onChange}
      />,
    );

    const editorEl = container.querySelector(".vault-editor") as HTMLElement;
    expect(editorEl).toBeTruthy();

    const fakeFile = new File(['{"type":"excalidraw"}'], "other.excalidraw", {
      type: "application/vnd.excalidraw+json",
    });

    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as any;
    dropEvent.dataTransfer = {
      files: [fakeFile],
    };
    dropEvent.shiftKey = false;

    fireEvent(editorEl, dropEvent);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain(
      "To open another drawing, copy it into your vault",
    );
    expect(dropEvent.defaultPrevented).toBe(true);
  });

  it("permits shift-drop for intentional content insertion without warning alert", () => {
    const onChange = vi.fn();
    const { container } = render(
      <VaultEditor
        documentId="doc-safety-2"
        initialJson={BLANK_SCENE}
        name="test.excalidraw"
        onChange={onChange}
      />,
    );

    const editorEl = container.querySelector(".vault-editor") as HTMLElement;
    const fakeFile = new File(['{"type":"excalidraw"}'], "snippet.png", {
      type: "image/png",
    });

    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as any;
    dropEvent.dataTransfer = {
      files: [fakeFile],
    };
    dropEvent.shiftKey = true;

    fireEvent(editorEl, dropEvent);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(dropEvent.defaultPrevented).toBe(false);
  });

  it("lets plain image drops reach the canvas but guards embedded-scene exports", () => {
    const { container } = render(
      <VaultEditor
        documentId="doc-safety-img"
        initialJson={BLANK_SCENE}
        name="test.excalidraw"
        onChange={vi.fn()}
      />,
    );
    const editorEl = container.querySelector(".vault-editor") as HTMLElement;
    const drop = (name: string, type: string) => {
      const event = new Event("drop", {
        bubbles: true,
        cancelable: true,
      }) as any;
      event.dataTransfer = { files: [new File(["x"], name, { type })] };
      event.shiftKey = false;
      fireEvent(editorEl, event);
      return event.defaultPrevented as boolean;
    };
    expect(drop("photo.png", "image/png")).toBe(false);
    expect(drop("logo.svg", "image/svg+xml")).toBe(false);
    expect(drop("board.excalidraw.png", "image/png")).toBe(true);
  });

  it("mounts safely with readOnly and disabled flags", () => {
    const onChange = vi.fn();
    const { container } = render(
      <VaultEditor
        documentId="doc-safety-3"
        initialJson={BLANK_SCENE}
        name="readonly.excalidraw"
        onChange={onChange}
        readOnly={true}
        disabled={true}
      />,
    );

    const editorEl = container.querySelector(".vault-editor");
    expect(editorEl).toBeTruthy();
    expect(editorEl?.getAttribute("data-document-id")).toBe("doc-safety-3");
  });

  it("supports theme prop and does not force blur active textarea during idle debounce", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const onThemeChange = vi.fn();
      const { container } = render(
        <VaultEditor
          documentId="doc-safety-4"
          initialJson={BLANK_SCENE}
          name="theme-test.excalidraw"
          onChange={onChange}
          theme="dark"
          onThemeChange={onThemeChange}
        />,
      );

      const editorEl = container.querySelector(".vault-editor");
      expect(editorEl).toBeTruthy();

      // Create an active textarea inside the editor simulating text editing
      const textarea = document.createElement("textarea");
      editorEl?.appendChild(textarea);
      textarea.focus();
      expect(document.activeElement).toBe(textarea);

      // Fast-forward timers by 2 seconds - focus must remain on the textarea
      vi.advanceTimersByTime(2000);
      expect(document.activeElement).toBe(textarea);
    } finally {
      vi.useRealTimers();
    }
  });
});
