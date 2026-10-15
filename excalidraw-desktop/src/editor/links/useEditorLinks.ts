/**
 * The one hook the editor mounts for links. At idle it costs: one childList
 * MutationObserver (when autocomplete is on) and three tiny key/blur
 * listeners; everything else is attached on demand (see each controller).
 *
 *   const links = useEditorLinks({ api, containerEl, settings, names, currentPath, callbacks });
 *   <Excalidraw onLinkOpen={links.onLinkOpen} ... />   {links.overlays}
 */
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { linkTargetFor, shapeLinkValue } from "../../links/format";
import { createResolver } from "../../links/resolve";

import { applyEdits as applyEditsTo, setElementLinks } from "./applyEdits";
import { CmdHoverOverlay } from "./CmdHoverOverlay";
import { LinkHintsOverlay } from "./LinkHintsOverlay";
import { LinkHints } from "./linkHints";
import { LinkSuggest } from "./LinkSuggest";
import { createLinkOpener, createOnLinkOpen } from "./onLinkOpen";
import { remeasureElements } from "./remeasure";
import { linksOf } from "./textLinkHitTest";
import { useModifierLinks } from "./useModifierLinks";
import { WikiAutocomplete } from "./wikiAutocomplete";

import type { ReactNode } from "react";

import type {
  ElementEdit,
  LinksSettings,
  Resolution,
  VaultLinks,
} from "../../links/types";
import type { LinkOpenCallbacks } from "./onLinkOpen";
import type { TextLike } from "./textLinkHitTest";

export type EditorLinksCallbacks = LinkOpenCallbacks & {
  /** `+ Create "x"` in the autocomplete popup: the app creates the drawing. */
  onCreate(target: string): void;
};

export type UseEditorLinksOptions = {
  api: ExcalidrawImperativeAPI | null;
  /** The editor's container element (the wrapper around `<Excalidraw>`). */
  containerEl: HTMLElement | null;
  settings: LinksSettings;
  /** Vault drawing paths (the palette's names list). */
  names: readonly string[];
  currentPath: string | null;
  callbacks: EditorLinksCallbacks;
  /** Optional: asked when the name list does not know a target. */
  links?: VaultLinks | null;
  handle?: string | null;
  /** Palette recents (`drawing:<path>` keys) to rank autocomplete rows. */
  getRecent?: () => readonly string[];
};

type El = TextLike & { link?: string | null };

export function useEditorLinks(opts: UseEditorLinksOptions) {
  const latest = useRef(opts);
  latest.current = opts;
  const resolver = useMemo(() => createResolver(opts.names), [opts.names]);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  const openRaw = useMemo(
    () =>
      createLinkOpener({
        getFromPath: () => latest.current.currentPath,
        getResolver: () => resolverRef.current,
        getCallbacks: () => latest.current.callbacks,
        fallbackResolve: (from, raw): Promise<Resolution> => {
          const { links, handle } = latest.current;
          return links && handle
            ? links.resolve(handle, from, raw)
            : Promise.reject(new Error("no link index"));
        },
      }),
    [],
  );
  const onLinkOpen = useMemo(() => createOnLinkOpen(openRaw), [openRaw]);

  const getApi = useCallback(() => latest.current.api, []);
  const modifier = useModifierLinks(opts.containerEl, {
    getApi,
    getModifier: () => latest.current.settings.openModifier,
    openRaw,
  });

  const hints = useMemo(
    () =>
      new LinkHints({
        getApi,
        getHintChars: () => latest.current.settings.hintChars,
        openRaw,
      }),
    [getApi, openRaw],
  );
  useEffect(() => () => hints.cancel(), [hints]);

  const autocomplete = useMemo(
    () =>
      opts.containerEl
        ? new WikiAutocomplete({
            container: opts.containerEl,
            getNames: () => latest.current.names,
            getResolver: () => resolverRef.current,
            getSettings: () => latest.current.settings,
            getCurrentPath: () => latest.current.currentPath,
            getRecent: () => latest.current.getRecent?.() ?? [],
            onCreate: (t) => latest.current.callbacks.onCreate(t),
          })
        : null,
    [opts.containerEl],
  );
  const autocompleteOn = opts.settings.autocomplete;
  useEffect(() => {
    if (!autocomplete || !autocompleteOn) {
      return undefined;
    }
    autocomplete.start();
    return () => autocomplete.stop();
  }, [autocomplete, autocompleteOn]);

  const startLinkHints = useCallback(() => hints.start(), [hints]);

  const openLinkUnderSelection = useCallback((): boolean => {
    const api = latest.current.api;
    if (!api) {
      return false;
    }
    const selected = api.getAppState().selectedElementIds;
    const all = api.getSceneElements() as unknown as El[];
    for (const el of all) {
      if (!selected[el.id]) {
        continue;
      }
      if (el.link && openRaw(el.link)) {
        return true;
      }
      const texts =
        el.type === "text" ? [el] : all.filter((t) => t.containerId === el.id);
      for (const t of texts) {
        const first = linksOf(t)[0];
        if (first && openRaw(`[[${first.target}]]`)) {
          return true;
        }
      }
    }
    return false;
  }, [openRaw]);

  /** "Link selection to drawing...": write the link on every selected element. */
  const linkSelectionTo = useCallback((targetPath: string): number => {
    const { api, settings, currentPath } = latest.current;
    if (!api) {
      return 0;
    }
    const target = linkTargetFor(
      targetPath,
      currentPath,
      resolverRef.current,
      settings.newLinkFormat,
    );
    const ids = Object.keys(api.getAppState().selectedElementIds);
    return setElementLinks(
      api,
      ids,
      shapeLinkValue(target, settings.shapeLinkFormat),
    );
  }, []);

  /** The text to put inside `[[...]]` for the drawing at `path`. */
  const targetFor = useCallback((path: string): string => {
    const { settings, currentPath } = latest.current;
    return linkTargetFor(
      path,
      currentPath,
      resolverRef.current,
      settings.newLinkFormat,
    );
  }, []);

  const applyEdits = useCallback((edits: readonly ElementEdit[]): number => {
    const api = latest.current.api;
    return api ? applyEditsTo(api, edits) : 0;
  }, []);

  const remeasure = useCallback((ids: readonly string[]): Promise<number> => {
    const api = latest.current.api;
    return api ? remeasureElements(api, ids) : Promise.resolve(0);
  }, []);

  const overlays: ReactNode = useMemo(
    () =>
      createElement(
        Fragment,
        null,
        modifier && createElement(CmdHoverOverlay, { links: modifier }),
        autocomplete &&
          createElement(LinkSuggest, { controller: autocomplete }),
        createElement(LinkHintsOverlay, { hints }),
      ),
    [modifier, autocomplete, hints],
  );

  return {
    onLinkOpen,
    startLinkHints,
    openLinkUnderSelection,
    linkSelectionTo,
    targetFor,
    applyEdits,
    remeasure,
    overlays,
  };
}
