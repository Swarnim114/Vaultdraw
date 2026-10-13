/**
 * Variant -> `--vault-*` CSS custom properties (see VaultShell.css `:root` /
 * `html.dark` for the meaning of each).
 *
 * Design: the whole app should feel like one surface with the canvas.
 *   --vault-canvas / --vault-bg   = mSurface (exactly the canvas colour)
 *   --vault-surface (header, sidebar) = mSurface stepped a hair (ΔE≈0.028)
 *                                   towards mSurfaceVariant (or text)
 *   --vault-menu-bg               = a raised surface (lighter in dark mode,
 *                                   brightest surface in light mode)
 * Guarantees (WCAG): text ≥ 7:1, muted ≥ 4.5:1, faint ≥ 3:1 on bg, surface
 * and menu; on-primary ≥ 4.5:1 on primary (hover/active only move away from it).
 */

import {
  adjustLightness,
  contrastRatio,
  ensureContrast,
  ensureContrastAll,
  hexToOklab,
  mix,
  oklabDistance,
  stepToward,
  toRgba,
} from "./color";

import type { ThemeMode, ThemeTokens, ThemeVariant } from "./types";

export const CONTRAST = {
  text: 7,
  muted: 4.5,
  faint: 3,
  onPrimary: 4.5,
  /** status colours are used as text on their own -bg and on surfaces */
  status: 4.5,
} as const;

const SHADOW_ALPHA: Record<ThemeMode, [number, number, number]> = {
  light: [0.05, 0.08, 0.12],
  dark: [0.3, 0.35, 0.5],
};

export const deriveTokens = (
  variant: ThemeVariant,
  mode: ThemeMode,
): ThemeTokens => {
  const dark = mode === "dark";
  const canvas = variant.mSurface;
  const bg = canvas;
  const onSurface = variant.mOnSurface;

  // Chrome: a gentle step from the canvas towards the palette's own
  // surface-variant (keeps its tint); towards text if the variant is too close.
  const chromeTarget =
    oklabDistance(canvas, variant.mSurfaceVariant) >= 0.03
      ? variant.mSurfaceVariant
      : onSurface;
  const surface = stepToward(canvas, chromeTarget, 0.028);
  const surfaceHover = stepToward(surface, onSurface, 0.045);
  const surfaceActive = mix(surface, variant.mPrimary, dark ? 0.16 : 0.12);

  const border = stepToward(surface, onSurface, dark ? 0.045 : 0.05);
  const borderStrong = stepToward(surface, onSurface, dark ? 0.09 : 0.1);

  const text = ensureContrastAll(onSurface, [bg, surface], CONTRAST.text);

  let menu: string;
  if (dark) {
    // Raised = lighter, but never so light that text drops below 7:1.
    let lift = 0.07;
    menu = stepToward(canvas, onSurface, lift);
    while (contrastRatio(text, menu) < CONTRAST.text && lift > 0) {
      lift = Math.max(0, lift - 0.005);
      menu = stepToward(canvas, onSurface, lift);
    }
  } else {
    // Raised = the brightest surface.
    const base =
      hexToOklab(canvas).l >= hexToOklab(surface).l ? canvas : surface;
    menu = hexToOklab(base).l > 0.97 ? base : stepToward(base, "#ffffff", 0.02);
  }

  const textBgs = [bg, surface, menu];

  // Muted: palette's on-surface-variant when it really is quieter than text.
  const mutedSeed =
    contrastRatio(variant.mOnSurfaceVariant, bg) <
      contrastRatio(text, bg) - 0.5 &&
    contrastRatio(variant.mOnSurfaceVariant, bg) > 2
      ? variant.mOnSurfaceVariant
      : mix(text, bg, 0.35);
  const textMuted = ensureContrastAll(mutedSeed, textBgs, CONTRAST.muted);
  const textFaint = ensureContrastAll(
    mix(textMuted, bg, 0.35),
    textBgs,
    CONTRAST.faint,
  );

  // Primary: keep the palette accent, only nudged if it vanishes into the UI.
  const primary = ensureContrastAll(variant.mPrimary, [bg, surface], 3);
  const onPrimary = ensureContrast(
    variant.mOnPrimary,
    primary,
    CONTRAST.onPrimary,
  );
  // Hover/active move away from the on-primary colour so its label only
  // gains contrast (light label → darker states, dark label → lighter).
  const away = hexToOklab(onPrimary).l > hexToOklab(primary).l ? -1 : 1;
  const primaryHover = adjustLightness(primary, away * (dark ? 0.04 : 0.05));
  const primaryActive = adjustLightness(primary, away * (dark ? 0.08 : 0.1));
  const primaryLight = mix(bg, primary, dark ? 0.15 : 0.1);
  const primaryBorder = mix(bg, primary, dark ? 0.4 : 0.3);

  const status = (seed: string) => {
    const bgTint = mix(bg, seed, dark ? 0.14 : 0.09);
    const fg = ensureContrastAll(seed, [bg, surface, bgTint], CONTRAST.status);
    return {
      fg,
      bg: mix(bg, fg, dark ? 0.14 : 0.09),
      border: mix(bg, fg, dark ? 0.35 : 0.28),
    };
  };
  // Re-check fg against the final tint (it is derived from the adjusted fg).
  const finalize = (s: ReturnType<typeof status>) => ({
    ...s,
    fg: ensureContrastAll(s.fg, [bg, surface, s.bg], CONTRAST.status),
  });
  const success = finalize(status(variant.terminal.normal.green));
  const warning = finalize(status(variant.terminal.normal.yellow));
  const danger = finalize(status(variant.mError));
  const dangerHover = ensureContrast(
    adjustLightness(danger.fg, dark ? 0.06 : -0.06),
    bg,
    CONTRAST.status,
  );

  const shadow =
    hexToOklab(variant.mShadow).l < 0.35 ? variant.mShadow : "#000000";
  const [sa, ma, la] = SHADOW_ALPHA[mode];

  return {
    "--vault-canvas": canvas,
    "--vault-bg": bg,
    "--vault-surface": surface,
    "--vault-surface-hover": surfaceHover,
    "--vault-surface-active": surfaceActive,
    "--vault-border": border,
    "--vault-border-strong": borderStrong,
    "--vault-menu-bg": menu,
    "--vault-text": text,
    "--vault-text-muted": textMuted,
    "--vault-text-faint": textFaint,
    "--vault-primary": primary,
    "--vault-primary-hover": primaryHover,
    "--vault-primary-active": primaryActive,
    "--vault-primary-light": primaryLight,
    "--vault-primary-border": primaryBorder,
    "--vault-on-primary": onPrimary,
    "--vault-success": success.fg,
    "--vault-success-bg": success.bg,
    "--vault-success-border": success.border,
    "--vault-warning": warning.fg,
    "--vault-warning-bg": warning.bg,
    "--vault-warning-border": warning.border,
    "--vault-danger": danger.fg,
    "--vault-danger-bg": danger.bg,
    "--vault-danger-border": danger.border,
    "--vault-danger-hover": dangerHover,
    "--vault-shadow-sm": `0 1px 2px ${toRgba(shadow, sa)}`,
    "--vault-shadow-md": `0 4px 12px ${toRgba(shadow, ma)}`,
    "--vault-shadow-lg": `0 12px 32px ${toRgba(shadow, la)}`,
  };
};
