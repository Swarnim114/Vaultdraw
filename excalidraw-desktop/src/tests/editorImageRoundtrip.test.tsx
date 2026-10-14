/**
 * Editor integration tests:
 * - Real serializeAsJSON / loadFromBlob roundtrip with embedded images
 * - VaultEditor mount, bridge tests, export routing, and flush barrier
 */
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";

import { VaultEditor } from "../editor/VaultEditor";
import { flushEditorSerialization } from "../editor/editorFlush";

import {
  BLANK_SCENE,
  IMAGE_FILE_ID,
  IMAGE_SCENE,
  SAMPLE_SCENE,
} from "./fixtures";

// Export actions live in Excalidraw's main (hamburger) menu.
const openMainMenu = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("main-menu-trigger"));
  });
};

const clickMenuItem = async (label: string) => {
  await openMainMenu();
  const item = await screen.findByText(label);
  await act(async () => {
    fireEvent.click(item);
  });
};

describe("real loadFromBlob and serializeAsJSON roundtrip", () => {
  it("restores scene and embedded image files with fidelity", async () => {
    const blob = new Blob([IMAGE_SCENE], { type: "application/json" });
    const scene = await loadFromBlob(blob, null, null, null);

    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0].type).toBe("image");
    expect((scene.elements[0] as { fileId?: string }).fileId).toBe(
      IMAGE_FILE_ID,
    );
    expect(scene.files[IMAGE_FILE_ID]).toBeDefined();
    expect(scene.files[IMAGE_FILE_ID].dataURL).toMatch(
      /^data:image\/png;base64,/,
    );

    const serialized = serializeAsJSON(
      scene.elements,
      scene.appState,
      scene.files,
      "local",
    );
    const parsed = JSON.parse(serialized);
    expect(parsed.type).toBe("excalidraw");
    expect(parsed.version).toBe(2);
    expect(parsed.files[IMAGE_FILE_ID]).toBeDefined();
    expect(parsed.files[IMAGE_FILE_ID].dataURL).toBe(
      scene.files[IMAGE_FILE_ID].dataURL,
    );

    // Second roundtrip from serialized output
    const blob2 = new Blob([serialized], { type: "application/json" });
    const scene2 = await loadFromBlob(blob2, null, null, null);
    expect(scene2.elements[0].type).toBe("image");
    expect((scene2.elements[0] as { fileId?: string }).fileId).toBe(
      IMAGE_FILE_ID,
    );
    expect(scene2.files[IMAGE_FILE_ID].dataURL).toBe(
      scene.files[IMAGE_FILE_ID].dataURL,
    );
  });

  it("strips previous file handles on load to isolate document history", async () => {
    const blob = new Blob([SAMPLE_SCENE], { type: "application/json" });
    const scene = await loadFromBlob(blob, null, null, null);
    expect(scene.appState.fileHandle).toBeNull();
  });
});

describe("VaultEditor component and bridge tests", () => {
  it("mounts VaultEditor with export actions and container attributes", async () => {
    const onChange = vi.fn();
    const onExport = vi.fn().mockResolvedValue(true);

    const { container } = render(
      <VaultEditor
        documentId="doc-image-1"
        initialSource={{ json: IMAGE_SCENE }}
        name="test-diagram.excalidraw"
        onChange={onChange}
        onExport={onExport}
      />,
    );

    const editorEl = container.querySelector(".vault-editor");
    expect(editorEl).toBeTruthy();
    expect(editorEl?.getAttribute("data-document-id")).toBe("doc-image-1");

    await waitFor(() => {
      if (!container.querySelector("canvas.interactive")) {
        throw new Error("canvas not ready");
      }
      if ((window as any).h?.state?.isLoading) {
        throw new Error("still loading");
      }
    });
    await openMainMenu();
    expect(await screen.findByText("Export image...")).toBeInTheDocument();
    // Mermaid lives in the toolbar's "More tools" and the command palette only.
    expect(screen.queryByText("Insert Mermaid diagram…")).toBeNull();
    expect(screen.getByText("Save a copy…")).toBeInTheDocument();
  });

  it("routes 'Save copy' export through onExport with serialized bytes", async () => {
    const onChange = vi.fn();
    const onExport = vi.fn().mockResolvedValue(true);

    const { container } = render(
      <VaultEditor
        documentId="doc-export-1"
        initialSource={{ json: BLANK_SCENE }}
        name="my-drawing.excalidraw"
        onChange={onChange}
        onExport={onExport}
      />,
    );

    // Wait for Excalidraw editor to initialize
    await waitFor(() => {
      const canvas = container.querySelector("canvas.interactive");
      if (!canvas) {
        throw new Error("canvas not ready");
      }
      if ((window as any).h?.state?.isLoading) {
        throw new Error("still loading");
      }
    });

    await clickMenuItem("Save a copy…");

    await waitFor(() => {
      expect(onExport).toHaveBeenCalled();
    });

    const [filename, bytes] = onExport.mock.calls[0];
    expect(filename).toBe("my-drawing.excalidraw");
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"type": "excalidraw"');
  });

  it("handles keyboard shortcut Ctrl+S / Cmd+S without error", async () => {
    const onChange = vi.fn();
    const onExport = vi.fn().mockResolvedValue(true);

    const { container } = render(
      <VaultEditor
        documentId="doc-shortcut-1"
        initialSource={{ json: BLANK_SCENE }}
        name="shortcut.excalidraw"
        onChange={onChange}
        onExport={onExport}
      />,
    );

    const editorEl = container.querySelector(".vault-editor");
    expect(editorEl).toBeTruthy();

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    // Flush bridge check
    flushEditorSerialization("doc-shortcut-1");
  });

  it("unmounting cleans up flush registration", () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <VaultEditor
        documentId="doc-cleanup-1"
        initialSource={{ json: BLANK_SCENE }}
        name="cleanup.excalidraw"
        onChange={onChange}
      />,
    );

    unmount();
    // Flush should be a no-op after unmount
    flushEditorSerialization("doc-cleanup-1");
    expect(onChange).not.toHaveBeenCalled();
  });
});
