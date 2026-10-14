/**
 * Handlers of the "Page" commands (metadata: commands/editorCommands.ts).
 * Bound through registerCommandHandlers while the editor is mounted; they
 * read the live editor at call time, so nothing runs while idle.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  isPageModeOn,
  PAGE_LAYOUTS,
  PAGE_ORIENTATIONS,
  PAGE_SIZE_PRESET_IDS,
  PAPER_THEMES,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  pageLayoutCommandId,
  pageOrientationCommandId,
  pagePaperCommandId,
  pageSizeCommandId,
} from "../commands/editorCommands";
import { getDefaultPageSetup } from "../vault/pageDefaults";

import { fitContentToPage } from "./fitContent";
import { getPageSetupPatch } from "./pageSetupChange";
import { getPageStepScroll } from "./pageView";

import type { CommandHandlers } from "../commands/types";

export interface PageCommandDeps {
  getApi(): ExcalidrawImperativeAPI | null;
  getWindow(): Window | null;
  /** The editor ignores input (interaction off). */
  isDisabled(): boolean;
  openPageSetup(): void;
}

type PageApi = Pick<
  ExcalidrawImperativeAPI,
  "getAppState" | "getSceneElementsIncludingDeleted" | "updateScene"
>;

/** Applies `changes` to the drawing's page setup (undoable). A drawing without one starts from the app default, page mode off unless `changes` says otherwise. */
export const applyPageSetup = (
  api: PageApi,
  changes: Partial<PageSetup>,
  win: Window | null,
): void => {
  const state = api.getAppState();
  const full = state.pageSetup
    ? changes
    : { ...getDefaultPageSetup(win), enabled: false, ...changes };
  api.updateScene({
    appState: getPageSetupPatch(state, full),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** Moves the whole drawing onto the pages (undoable). False when page mode is off or there is nothing to fit. */
export const applyFitContent = (api: PageApi): boolean => {
  const setup = api.getAppState().pageSetup;
  if (!isPageModeOn(setup)) {
    return false;
  }
  const result = fitContentToPage(
    api.getSceneElementsIncludingDeleted(),
    setup,
  );
  if (!result) {
    return false;
  }
  api.updateScene({
    elements: result.elements,
    appState: { pageSetup: { ...setup, pageCount: result.pageCount } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return true;
};

const stepPage = (api: PageApi, direction: 1 | -1) => {
  const scroll = getPageStepScroll(api.getAppState(), direction);
  if (scroll) {
    api.updateScene({ appState: scroll });
  }
};

/** Everything except next/previous page (those are bound only while page mode is on). */
export const createPageHandlers = (deps: PageCommandDeps): CommandHandlers => {
  const editable = (run: (api: ExcalidrawImperativeAPI) => void) => () => {
    const api = deps.getApi();
    if (!api || deps.isDisabled() || api.getAppState().viewModeEnabled) {
      return;
    }
    run(api);
  };
  const set = (changes: Partial<PageSetup>) =>
    editable((api) => applyPageSetup(api, changes, deps.getWindow()));

  const handlers: CommandHandlers = {
    "page.on": set({ enabled: true }),
    "page.off": set({ enabled: false }),
    "page.toggle": editable((api) =>
      applyPageSetup(
        api,
        { enabled: !isPageModeOn(api.getAppState().pageSetup) },
        deps.getWindow(),
      ),
    ),
    "page.setup": editable(() => deps.openPageSetup()),
    "page.fitContent": editable((api) => {
      applyFitContent(api);
    }),
  };
  for (const layout of PAGE_LAYOUTS) {
    handlers[pageLayoutCommandId(layout)] = set({ layout });
  }
  for (const size of PAGE_SIZE_PRESET_IDS) {
    handlers[pageSizeCommandId(size)] = set({ size });
  }
  for (const orientation of PAGE_ORIENTATIONS) {
    handlers[pageOrientationCommandId(orientation)] = editable((api) => {
      const setup = api.getAppState().pageSetup;
      // custom sizes carry their own width/height: swap them with the turn
      const swap =
        setup?.size === "custom" && setup.orientation !== orientation
          ? { width: setup.height, height: setup.width }
          : {};
      applyPageSetup(api, { orientation, ...swap }, deps.getWindow());
    });
  }
  for (const paperTheme of PAPER_THEMES) {
    handlers[pagePaperCommandId(paperTheme)] = set({ paperTheme });
  }
  return handlers;
};

/** Page navigation: scrolling, so it also works in a read-only drawing. */
export const createPageNavigationHandlers = (
  getApi: () => PageApi | null,
): CommandHandlers => ({
  "page.next": () => {
    const api = getApi();
    if (api) {
      stepPage(api, 1);
    }
  },
  "page.previous": () => {
    const api = getApi();
    if (api) {
      stepPage(api, -1);
    }
  },
});
