import {
  PAGE_SIZE_PRESETS,
  PAGE_SIZE_PRESET_IDS,
  PAPER_THEMES,
  PAPER_THEME_LABELS,
  type PageLayout,
  type PageOrientation,
  type PageSetup,
  type PageSize,
  type PaperTheme,
} from "@excalidraw/excalidraw/data/pageSetup";

/** Option lists and small helpers shared by the Settings page and the per-drawing dialog. */

export const LAYOUT_OPTIONS: readonly { label: string; val: PageLayout }[] = [
  { label: "Continuous", val: "continuous" },
  { label: "Separate pages", val: "separate" },
];

export const ORIENTATION_OPTIONS: readonly {
  label: string;
  val: PageOrientation;
}[] = [
  { label: "Portrait", val: "portrait" },
  { label: "Landscape", val: "landscape" },
];

export const PAPER_THEME_OPTIONS: readonly {
  label: string;
  val: PaperTheme;
}[] = PAPER_THEMES.map((val) => ({ label: PAPER_THEME_LABELS[val], val }));

export const SIZE_OPTIONS: readonly { label: string; val: PageSize }[] = [
  ...PAGE_SIZE_PRESET_IDS.map((val) => ({
    label: PAGE_SIZE_PRESETS[val].label,
    val,
  })),
  { label: "Custom", val: "custom" },
];

/** Orientation change; a custom size swaps its sides (presets re-derive them). */
export const orientationChanges = (
  setup: PageSetup,
  orientation: PageOrientation,
): Partial<PageSetup> =>
  orientation !== setup.orientation && setup.size === "custom"
    ? { orientation, width: setup.height, height: setup.width }
    : { orientation };

/** Short summary for menus: "Off" or "A4 · Separate". */
export const describePageSetup = (setup: PageSetup | null): string => {
  if (!setup?.enabled) {
    return "Off";
  }
  const size =
    setup.size === "custom"
      ? `${setup.width}×${setup.height}`
      : PAGE_SIZE_PRESETS[setup.size].label;
  const layout = LAYOUT_OPTIONS.find((o) => o.val === setup.layout)!;
  return `${size} · ${layout.val === "separate" ? "Separate" : layout.label}`;
};
