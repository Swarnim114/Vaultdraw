import { expect, vi } from "vitest";

import { Excalidraw } from "../index";
import { convertMermaidToExcalidraw } from "../components/TTDDialog/common";
import { PREVIEW_DEBOUNCE_MS } from "../components/TTDDialog/MermaidToExcalidraw";

import { mockMermaidToExcalidraw } from "./helpers/mocks";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { fireEvent, render, screen, waitFor } from "./test-utils";

vi.mock("@codemirror/view", () => ({}));
vi.mock("@codemirror/state", () => ({}));
vi.mock("@codemirror/language", () => ({}));
vi.mock("@lezer/highlight", () => ({}));

const rect = {
  id: "A",
  type: "rectangle",
  groupIds: [],
  x: 0,
  y: 0,
  width: 50,
  height: 40,
  strokeWidth: 2,
  link: null,
};

const parse = vi.fn(async (definition: string) => {
  if (definition.startsWith("bad")) {
    throw new Error("ERROR");
  }
  return {
    elements: [{ ...rect, width: definition.length }],
  } as any;
});

mockMermaidToExcalidraw({
  mockRef: true,
  parseMermaidToExcalidraw: parse as any,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MermaidToExcalidraw debounce and stale guard", () => {
  beforeEach(async () => {
    parse.mockClear();
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
  });

  it("converts once, after typing stops", async () => {
    const editor = await getTextEditor({
      selector: ".ttd-dialog-input",
      waitForEditor: true,
    });
    parse.mockClear();

    for (const value of [
      "flowchart TD\n a",
      "flowchart TD\n ab",
      "flowchart TD\n abc",
    ]) {
      updateTextEditor(editor, value);
      await sleep(20);
    }
    expect(parse).not.toHaveBeenCalled();

    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1), {
      timeout: PREVIEW_DEBOUNCE_MS * 4,
    });
    expect(parse).toHaveBeenCalledWith("flowchart TD\n abc");
  });

  it("Insert uses the latest text even before the debounce elapsed", async () => {
    const editor = await getTextEditor({
      selector: ".ttd-dialog-input",
      waitForEditor: true,
    });
    const latest = "flowchart TD\n latest definition";
    updateTextEditor(editor, latest);
    fireEvent.click(screen.getByText("Insert"));

    await waitFor(() => expect(window.h.elements).toHaveLength(1));
    expect(window.h.elements[0].width).toBe(latest.length);
  });

  it("Insert inserts nothing for empty text", async () => {
    const editor = await getTextEditor({
      selector: ".ttd-dialog-input",
      waitForEditor: true,
    });
    updateTextEditor(editor, "");
    fireEvent.click(screen.getByText("Insert"));
    await sleep(PREVIEW_DEBOUNCE_MS + 100);

    expect(window.h.elements).toHaveLength(0);
  });
});

describe("convertMermaidToExcalidraw stale guard", () => {
  const setup = () => {
    const parent = document.createElement("div");
    const canvasNode = document.createElement("div");
    parent.appendChild(canvasNode);
    return {
      canvasRef: { current: canvasNode },
      data: { current: { elements: [], files: null } },
      setError: vi.fn(),
    };
  };

  it("a superseded conversion writes nothing", async () => {
    const env = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const lib = {
      loaded: true,
      api: Promise.resolve({
        parseMermaidToExcalidraw: async () => {
          await gate;
          return { elements: [rect] } as any;
        },
      }),
    };
    let stale = false;
    const pending = convertMermaidToExcalidraw({
      ...env,
      mermaidToExcalidrawLib: lib,
      mermaidDefinition: "flowchart TD\n a",
      theme: "light",
      isStale: () => stale,
    });
    stale = true;
    release();
    expect(await pending).toEqual({ success: false });
    expect(env.setError).not.toHaveBeenCalled();
    expect(env.data.current.elements).toHaveLength(0);
    expect(env.canvasRef.current.childElementCount).toBe(0);
  });

  it("a stale failure does not set an error", async () => {
    const env = setup();
    const lib = {
      loaded: true,
      api: Promise.resolve({
        parseMermaidToExcalidraw: async () => {
          throw new Error("late");
        },
      }),
    };
    await convertMermaidToExcalidraw({
      ...env,
      mermaidToExcalidrawLib: lib,
      mermaidDefinition: "x",
      theme: "light",
      isStale: () => true,
    });
    expect(env.setError).not.toHaveBeenCalled();
  });
});
