/**
 * Optional user accent colour: replaces the theme's primary (mPrimary) in
 * both modes. Everything else (hover/active/tints, Excalidraw variables)
 * follows through deriveTokens, whose contrast nudge still applies.
 */

import { contrastRatio, normalizeHex, pickOn } from "./color";
import { CONTRAST, deriveTokens } from "./tokens";

import type { ThemeMode, ThemeVariant } from "./types";

/** Normalised "#rrggbb" for a valid opaque accent, "" for none/invalid. */
export const normalizeAccent = (accent: unknown): string => {
  if (typeof accent !== "string") {
    return "";
  }
  // Alpha, if given, is dropped: meaningless for a UI accent.
  return normalizeHex(accent) ?? "";
};

/** The variant with `accent` as primary and a readable on-primary colour. */
export const applyAccent = (
  variant: ThemeVariant,
  accent: string,
  // Kept for API symmetry: the mode-specific variant is already selected.
  _mode?: ThemeMode,
): ThemeVariant => {
  const hex = normalizeAccent(accent);
  if (!hex) {
    return variant;
  }
  return {
    ...variant,
    mPrimary: hex,
    mOnPrimary: pickOn(
      hex,
      [
        variant.mOnPrimary,
        variant.mSurface,
        variant.mOnSurface,
        "#ffffff",
        "#000000",
      ],
      CONTRAST.onPrimary,
    ),
  };
};

export interface ResolvedAccent {
  /** The colour actually used as primary after the engine's contrast nudge. */
  primary: string;
  /** True when `primary` differs from the requested accent. */
  adjusted: boolean;
  /** Contrast of `primary` against the theme background. */
  ratio: number;
}

export const resolveAccent = (
  variant: ThemeVariant,
  accent: string,
  mode: ThemeMode,
): ResolvedAccent => {
  const requested = normalizeAccent(accent);
  const tokens = deriveTokens(applyAccent(variant, accent, mode), mode);
  const primary = tokens["--vault-primary"];
  return {
    primary,
    adjusted: !!requested && normalizeHex(primary) !== requested,
    ratio: contrastRatio(primary, tokens["--vault-bg"]),
  };
};
