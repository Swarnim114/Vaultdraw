/**
 * Hover dwell controller. Mode "off" never gets constructed/started. Otherwise
 * one passive pointermove listener on the container (rAF-coalesced, one hit
 * test per frame) plus tiny hide triggers (pointerdown, wheel, pointerleave,
 * keydown, blur). The card shows after DWELL_MS on the same link.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { isModifierHeld, modifierKeys, underlineRects } from "../modifierLinks";
import { clientToScene } from "../textLinkHitTest";

import { linkAt } from "./linkBoxes";

import type { HoverPreview, OpenModifier } from "../../../links/types";
import type { UnderlineRect } from "../modifierLinks";
import type { VersionedText } from "./linkBoxes";

export const DWELL_MS = 350;

export type ShownLink = {
  /** Link target as written (no brackets). */
  target: string;
  /** Fragment underlines in viewport coordinates. */
  rects: UnderlineRect[];
  /** Height of the first fragment's line in viewport px. */
  lineHeight: number;
};

export interface LinkPreviewDeps {
  container: HTMLElement;
  getApi(): ExcalidrawImperativeAPI | null;
  getMode(): HoverPreview;
  getModifier(): OpenModifier;
  /** A link to preview, or null to hide. */
  onShow(link: ShownLink | null): void;
}

type Pointer = Pick<MouseEvent, "clientX" | "clientY" | "target">;

export class LinkPreviewController {
  private key: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private last: Pointer | null = null;
  private held = false;
  private sig = "";
  private visible = false;

  constructor(private readonly deps: LinkPreviewDeps) {}

  start(): void {
    const c = this.deps.container;
    c.addEventListener("pointermove", this.onMove, { passive: true });
    c.addEventListener("pointerdown", this.hide, true);
    c.addEventListener("wheel", this.hide, { passive: true });
    c.addEventListener("pointerleave", this.hide);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.hide);
  }

  stop(): void {
    const c = this.deps.container;
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerdown", this.hide, true);
    c.removeEventListener("wheel", this.hide);
    c.removeEventListener("pointerleave", this.hide);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.hide);
    this.cancelPending();
    this.key = null;
    this.visible = false;
    this.last = null;
  }

  private cancelPending() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  /** Forget the candidate and hide the card. */
  private reset() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.key = null;
    if (this.visible) {
      this.visible = false;
      this.deps.onShow(null);
    }
  }

  private hide = () => {
    this.cancelPending();
    this.reset();
  };

  private onMove = (e: PointerEvent) => {
    if (e.buttons !== 0) {
      this.hide();
      return;
    }
    this.last = e;
    this.held = isModifierHeld(e, this.deps.getModifier());
    this.schedule();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      this.deps.getMode() === "modifier" &&
      modifierKeys(this.deps.getModifier()).includes(e.key)
    ) {
      // The modifier itself arms the preview over the current pointer spot.
      this.held = true;
      if (this.last) {
        this.schedule();
      }
      return;
    }
    this.hide();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (modifierKeys(this.deps.getModifier()).includes(e.key)) {
      this.held = false;
      if (this.deps.getMode() === "modifier") {
        this.hide();
      }
    }
  };

  private schedule() {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.last) {
          this.check(this.last);
        }
      });
    }
  }

  private check(p: Pointer) {
    const api = this.deps.getApi();
    const mode = this.deps.getMode();
    if (!api || mode === "off") {
      return this.reset();
    }
    const state = api.getAppState();
    if (
      state.editingTextElement ||
      state.newElement ||
      state.multiElement ||
      (p.target as Element | null)?.tagName !== "CANVAS" ||
      (mode === "modifier" && !this.held)
    ) {
      return this.reset();
    }
    const sig = `${state.scrollX}|${state.scrollY}|${state.zoom.value}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.reset();
    }
    const hit = linkAt(
      api.getSceneElements() as unknown as VersionedText[],
      clientToScene(p, state as never),
    );
    if (!hit) {
      return this.reset();
    }
    const key = `${hit.element.id}:${hit.span.start}`;
    if (key === this.key) {
      return;
    }
    this.reset();
    this.key = key;
    this.timer = setTimeout(() => {
      this.timer = null;
      const live = this.deps.getApi();
      if (!live) {
        return;
      }
      const s = live.getAppState();
      const f = hit.fragments[0];
      this.visible = true;
      this.deps.onShow({
        target: hit.span.target,
        rects: underlineRects(hit.fragments, hit.element, s as never),
        lineHeight: f ? (f.bottom - f.top) * s.zoom.value : 0,
      });
    }, DWELL_MS);
  }
}
