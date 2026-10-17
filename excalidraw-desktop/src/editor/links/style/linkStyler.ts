/**
 * Owns the installed text-run styler. The styler runs only when a text bitmap
 * is rasterised; this class keeps the inputs it reads (colour, resolution
 * memo) and invalidates only when an answer actually changed.
 */
import { applyDarkModeFilter, getDisplayColorKey } from "@excalidraw/common";
import {
  invalidateTextRunStyles,
  setTextRunStyler,
  type TextRun,
  type TextRunStyler,
} from "@excalidraw/element";

import { normalizeHex } from "../../../theme/color";

import { buildLinkRuns, linkPalette, linkSpansOf } from "./linkRuns";

import type { LinkResolver } from "../../../links/resolve";
import type { LinkPalette } from "./linkRuns";

export const FALLBACK_ACCENT = "#6965db";
const ACCENT_VAR = "--vault-primary";

export type LinkStylerOptions = {
  enabled: boolean;
  /** "accent" or "#rrggbb". */
  linkColor: string;
  resolver: LinkResolver;
  currentPath: string | null;
};

export type LinkStylerDeps = {
  repaint: () => void;
  /** Current accent colour; defaults to the `--vault-primary` CSS variable. */
  readAccent?: () => string;
  root?: HTMLElement;
};

/**
 * Installed stylers, most recent last. The global hook belongs to the last
 * one; when it goes away the previous one gets it back, so an unmounting
 * second editor (history preview) never leaves the main editor unstyled.
 */
const installedStack: LinkStyler[] = [];

type RunsEntry = {
  version: number;
  palette: LinkPalette;
  /** Resolved flags of the element's spans, e.g. "10". */
  resolved: string;
  runs: TextRun[];
};

export class LinkStyler {
  private opts: LinkStylerOptions | null = null;
  private installed = false;
  private readonly memo = new Map<string, boolean>();
  /** Same runs array while nothing changed, so the renderer reuses its layout on zoom. */
  private runsCache = new WeakMap<object, RunsEntry>();
  private palette: { key: string; value: LinkPalette } | null = null;
  private lastAccent: string | null = null;
  private observer: MutationObserver | null = null;
  private readonly root: HTMLElement | undefined;
  private readonly readAccent: () => string;

  constructor(private readonly deps: LinkStylerDeps) {
    this.root =
      deps.root ??
      (typeof document !== "undefined" ? document.documentElement : undefined);
    this.readAccent =
      deps.readAccent ??
      (() =>
        this.root?.style.getPropertyValue(ACCENT_VAR).trim() ||
        FALLBACK_ACCENT);
  }

  get isInstalled() {
    return this.installed;
  }

  update(next: LinkStylerOptions) {
    const prev = this.opts;
    this.opts = next;
    if (!next.enabled) {
      this.uninstall();
      return;
    }
    if (!this.installed) {
      this.install();
      return;
    }
    let changed = prev?.linkColor !== next.linkColor;
    if (
      prev?.resolver !== next.resolver ||
      prev?.currentPath !== next.currentPath
    ) {
      changed = this.refreshMemo() || changed;
    }
    if (changed) {
      this.invalidate();
    }
  }

  dispose() {
    this.uninstall();
  }

  private install() {
    this.installed = true;
    this.memo.clear();
    this.palette = null;
    installedStack.push(this);
    setTextRunStyler(this.style);
    this.watchAccent();
    this.deps.repaint();
  }

  private uninstall() {
    this.observer?.disconnect();
    this.observer = null;
    if (!this.installed) {
      return;
    }
    this.installed = false;
    this.memo.clear();
    const wasOwner = installedStack[installedStack.length - 1] === this;
    const at = installedStack.indexOf(this);
    if (at >= 0) {
      installedStack.splice(at, 1);
    }
    if (wasOwner) {
      const next = installedStack[installedStack.length - 1];
      setTextRunStyler(next ? next.style : null);
      (next ?? this).deps.repaint();
    }
  }

  private invalidate() {
    invalidateTextRunStyles();
    this.deps.repaint();
  }

  private resolve(target: string): boolean {
    let ok = this.memo.get(target);
    if (ok === undefined) {
      const o = this.opts!;
      ok = o.resolver.resolveTarget(o.currentPath ?? "", target).path !== null;
      this.memo.set(target, ok);
    }
    return ok;
  }

  /** Recomputes memoised targets; true when any flipped. */
  private refreshMemo(): boolean {
    const o = this.opts!;
    let flipped = false;
    for (const [target, was] of this.memo) {
      const now =
        o.resolver.resolveTarget(o.currentPath ?? "", target).path !== null;
      if (now !== was) {
        this.memo.set(target, now);
        flipped = true;
      }
    }
    return flipped;
  }

  private baseColor(isDark: boolean): string {
    const color = this.opts!.linkColor;
    if (color === "accent") {
      this.lastAccent = this.readAccent();
      return this.lastAccent;
    }
    const hex = normalizeHex(color) ?? FALLBACK_ACCENT;
    return applyDarkModeFilter(hex, isDark);
  }

  private paletteFor(isDark: boolean): LinkPalette {
    const base = this.baseColor(isDark);
    const key = `${base}|${
      this.opts!.linkColor === "accent" ? "" : getDisplayColorKey()
    }`;
    if (this.palette?.key !== key) {
      this.palette = { key, value: linkPalette(base) };
    }
    return this.palette.value;
  }

  readonly style: TextRunStyler = (element, isDark) => {
    if (!this.opts) {
      return null;
    }
    const spans = linkSpansOf(element);
    if (spans.length === 0) {
      return null;
    }
    const palette = this.paletteFor(isDark);
    let resolved = "";
    for (const span of spans) {
      resolved += this.resolve(span.target) ? "1" : "0";
    }
    const hit = this.runsCache.get(element);
    if (
      hit &&
      hit.version === element.version &&
      hit.palette === palette &&
      hit.resolved === resolved
    ) {
      return hit.runs;
    }
    const runs = buildLinkRuns(element.text, spans, palette, (t) =>
      this.resolve(t),
    );
    this.runsCache.set(element, {
      version: element.version,
      palette,
      resolved,
      runs,
    });
    return runs;
  };

  private watchAccent() {
    if (!this.root || typeof MutationObserver === "undefined") {
      return;
    }
    this.observer = new MutationObserver(() => {
      if (
        this.opts?.linkColor === "accent" &&
        this.readAccent() !== this.lastAccent
      ) {
        this.invalidate();
      }
    });
    this.observer.observe(this.root, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }
}
