/**
 * Scene fixtures for vault round-trip and editor integration tests (QA scope).
 *
 * Plain JSON strings in the fork's supported `.excalidraw` source shape
 * (`type: "excalidraw"`, version 2). They carry no editor dependency so
 * contract tests stay lightweight; editor tests can feed them through
 * `loadFromBlob` / `serializeAsJSON(..., "local")` once installed.
 */

export const BLANK_SCENE = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-desktop-tests",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  },
  null,
  2,
);

export const SAMPLE_SCENE = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-desktop-tests",
    elements: [
      {
        id: "rect-1",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 240,
        height: 120,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        boundElements: [{ id: "arrow-1", type: "arrow" }],
        link: null,
        locked: false,
      },
      {
        id: "text-1",
        type: "text",
        x: 120,
        y: 130,
        width: 200,
        height: 30,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        boundElements: [],
        link: null,
        locked: false,
        text: "DSA — Dynamic Programming",
        fontSize: 20,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        baseline: 24,
      },
      {
        id: "arrow-1",
        type: "arrow",
        x: 340,
        y: 160,
        width: 120,
        height: 40,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: 2 },
        boundElements: [],
        link: null,
        locked: false,
        points: [
          [0, 0],
          [120, 40],
        ],
        startBinding: { elementId: "rect-1", focus: 0.5, gap: 4 },
        endBinding: null,
        startArrowhead: null,
        endArrowhead: "arrow",
      },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  },
  null,
  2,
);

// 1x1 transparent PNG — keeps the image fixture tiny while exercising the
// embedded-file path (files map + image element with fileId).
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const IMAGE_FILE_ID = "img-file-1";

export const IMAGE_SCENE = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-desktop-tests",
    elements: [
      {
        id: "image-1",
        type: "image",
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        angle: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        boundElements: [],
        link: null,
        locked: false,
        fileId: IMAGE_FILE_ID,
        status: "saved",
        scale: [1, 1],
      },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {
      [IMAGE_FILE_ID]: {
        mimeType: "image/png",
        id: IMAGE_FILE_ID,
        dataURL: TINY_PNG_DATA_URL,
        created: 1700000000000,
      },
    },
  },
  null,
  2,
);

/** Edited variant of SAMPLE_SCENE: simulates one user edit (moved rect). */
export function editedSampleScene(): string {
  const parsed = JSON.parse(SAMPLE_SCENE) as {
    elements: Array<{ id: string; x: number }>;
  };
  const rect = parsed.elements.find((el) => el.id === "rect-1");
  if (rect) {
    rect.x = 140;
  }
  return JSON.stringify(parsed, null, 2);
}

/** Generate a scene with N rectangles for scale/perf smoke tests. */
export function largeScene(count: number): string {
  const elements = Array.from({ length: count }, (_, i) => ({
    id: `rect-${i}`,
    type: "rectangle",
    x: (i % 100) * 30,
    y: Math.floor(i / 100) * 30,
    width: 20,
    height: 20,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    boundElements: [],
    link: null,
    locked: false,
  }));
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-desktop-tests",
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    },
    null,
    2,
  );
}

/** Extract embedded file dataURLs keyed by file id. */
export function embeddedFiles(json: string): Record<string, string> {
  const parsed = JSON.parse(json) as {
    files?: Record<string, { dataURL?: string }>;
  };
  const out: Record<string, string> = {};
  for (const [id, file] of Object.entries(parsed.files ?? {})) {
    if (file?.dataURL) {
      out[id] = file.dataURL;
    }
  }
  return out;
}
