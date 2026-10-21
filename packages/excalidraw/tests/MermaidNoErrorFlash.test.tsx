import { expect, vi } from "vitest";

import { Excalidraw } from "../index";

import { mockMermaidToExcalidraw } from "./helpers/mocks";
import { render, waitFor } from "./test-utils";

vi.mock("@codemirror/view", () => ({}));
vi.mock("@codemirror/state", () => ({}));
vi.mock("@codemirror/language", () => ({}));
vi.mock("@lezer/highlight", () => ({}));

mockMermaidToExcalidraw({
  parseMermaidToExcalidraw: (async () => ({
    elements: [
      {
        id: "A",
        type: "rectangle",
        groupIds: [],
        x: 0,
        y: 0,
        width: 50,
        height: 40,
        strokeWidth: 2,
        link: null,
      },
    ],
  })) as any,
});

describe("Mermaid dialog while the library loads", () => {
  it("never flashes an error for a valid definition", async () => {
    let sawError = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="ttd-dialog-output-error"]')) {
        sawError = true;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await render(
      <Excalidraw
        initialData={{
          appState: { openDialog: { name: "ttd", tab: "mermaid" } },
        }}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".ttd-dialog canvas")).not.toBeNull(),
    );
    observer.disconnect();
    expect(sawError).toBe(false);
  });
});
