import { normalizeAccent } from "../../theme/accent";

/** Preset accents offered after the theme's own (the design's seven). */
export const ACCENT_PRESETS: readonly { hex: string; name: string }[] = [
  { hex: "#e05a5a", name: "Red" },
  { hex: "#e59a2a", name: "Amber" },
  { hex: "#7cb35c", name: "Green" },
  { hex: "#3e9b8f", name: "Teal" },
  { hex: "#3b7fe0", name: "Blue" },
  { hex: "#8c5fd8", name: "Purple" },
  { hex: "#d05fa8", name: "Pink" },
];

export interface AccentSwatch {
  /** "" = the theme's own accent (clears the override). */
  hex: string;
  /** Colour painted on the swatch. */
  paint: string;
  name: string;
  selected: boolean;
}

export interface AccentSwatches {
  swatches: AccentSwatch[];
  /** The saved accent when it is none of the swatches (shown on "+"). */
  custom: string | null;
}

/**
 * The accent row: the theme's own colour first (selected when nothing is
 * saved), then the presets (a preset equal to the theme's own is dropped),
 * and `custom` for a saved colour that matches none of them.
 */
export const accentSwatches = (
  themeAccent: string,
  accentColor: string,
): AccentSwatches => {
  const own = normalizeAccent(themeAccent);
  const saved = normalizeAccent(accentColor);
  const presets = ACCENT_PRESETS.filter((p) => p.hex !== own);
  const swatches: AccentSwatch[] = [
    {
      hex: "",
      paint: themeAccent,
      name: "Theme accent",
      selected: saved === "" || saved === own,
    },
    ...presets.map((p) => ({
      hex: p.hex,
      paint: p.hex,
      name: p.name,
      selected: saved === p.hex,
    })),
  ];
  const custom = swatches.some((s) => s.selected) ? null : saved;
  return { swatches, custom };
};
