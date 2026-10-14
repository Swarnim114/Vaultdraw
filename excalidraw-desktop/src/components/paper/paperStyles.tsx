import type { BackgroundPatternType } from "@excalidraw/excalidraw/data/backgroundPattern";

import type { ReactNode } from "react";

export type PaperStyleId = BackgroundPatternType | "plain";

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const dot = (x: number, y: number) => (
  <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />
);

export const PAPER_STYLES: ReadonlyArray<{
  id: PaperStyleId;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "plain",
    label: "Plain",
    icon: svg(<rect x="4" y="4" width="16" height="16" rx="2" />),
  },
  {
    id: "grid",
    label: "Grid",
    icon: svg(<path d="M4 4h16v16H4zM4 12h16M12 4v16" />),
  },
  {
    id: "lines",
    label: "Lines",
    icon: svg(<path d="M4 7h16M4 12h16M4 17h16M8 4v16" />),
  },
  {
    id: "dots",
    label: "Dots",
    icon: svg(
      <>{[6, 12, 18].flatMap((x) => [6, 12, 18].map((y) => dot(x, y)))}</>,
    ),
  },
  {
    id: "graph",
    label: "Graph",
    icon: svg(
      <path d="M4 4h16v16H4zM4 8h16M4 12h16M4 16h16M8 4v16M12 4v16M16 4v16" />,
    ),
  },
  {
    id: "isometric",
    label: "Isometric",
    icon: svg(
      <>
        {[
          [6, 7],
          [12, 7],
          [18, 7],
          [9, 12],
          [15, 12],
          [6, 17],
          [12, 17],
          [18, 17],
        ].map(([x, y]) => dot(x, y))}
      </>,
    ),
  },
];
