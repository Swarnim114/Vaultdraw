/** Template scenes for the templates e2e/perf specs (also used by the harness). */

const base = (id: string, type: string, extra: Record<string, unknown>) => ({
  id,
  type,
  x: 0,
  y: 0,
  width: 100,
  height: 60,
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
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  ...extra,
});

/**
 * A grouped rectangle holding bound text, plus an arrow bound to the
 * rectangle: exercises every id reference instantiate has to remap.
 */
export const templateScene = (label: string, background = "#ffffff") =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e",
    elements: [
      base(`rect-${label}`, "rectangle", {
        x: 40,
        y: 40,
        width: 200,
        height: 100,
        backgroundColor: "#a5d8ff",
        groupIds: [`group-${label}`],
        boundElements: [
          { id: `text-${label}`, type: "text" },
          { id: `arrow-${label}`, type: "arrow" },
        ],
      }),
      base(`text-${label}`, "text", {
        x: 60,
        y: 70,
        width: 120,
        height: 25,
        groupIds: [`group-${label}`],
        text: label,
        originalText: label,
        fontSize: 20,
        fontFamily: 5,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: `rect-${label}`,
        lineHeight: 1.25,
        autoResize: true,
        baseline: 18,
      }),
      base(`arrow-${label}`, "arrow", {
        x: 240,
        y: 90,
        width: 120,
        height: 0,
        points: [
          [0, 0],
          [120, 0],
        ],
        startBinding: { elementId: `rect-${label}`, focus: 0, gap: 1 },
        endBinding: null,
        startArrowhead: null,
        endArrowhead: "arrow",
        lastCommittedPoint: null,
        elbowed: false,
      }),
    ],
    appState: { viewBackgroundColor: background },
    files: {},
  });

/** A few small shapes, for the 200-template perf vault. */
export const smallScene = (i: number) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-perf",
    elements: [0, 1, 2, 3, 4].map((k) =>
      base(`perf-${i}-${k}`, k % 2 ? "ellipse" : "rectangle", {
        x: (k % 3) * 70,
        y: Math.floor(k / 3) * 70,
        width: 60,
        height: 50,
        seed: i * 10 + k + 1,
        backgroundColor: k % 2 ? "#ffc9c9" : "#b2f2bb",
      }),
    ),
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });

export const TEMPLATE_BACKGROUNDS = {
  "Lecture Notes": "#ffe3e3",
  Flowchart: "#e7f5ff",
  "Kanban Board": "#fff9db",
} as const;
