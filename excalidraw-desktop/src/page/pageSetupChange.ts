/**
 * The one way to change a drawing's page setup: returns the appState patch
 * for `changes`. A paper theme change also stamps the theme's file colours
 * (page fill = viewBackgroundColor, pattern colour) so exports, PDF and other
 * apps see the same paper.
 */
import {
  PAPER_THEME_COLORS,
  updatePageSetup,
  type PageSetup,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { AppState } from "@excalidraw/excalidraw/types";

export type PageSetupPatch =
  | Pick<AppState, "pageSetup">
  | Pick<
      AppState,
      "pageSetup" | "viewBackgroundColor" | "viewBackgroundPattern"
    >;

export function getPageSetupPatch(
  appState: Pick<
    AppState,
    "pageSetup" | "viewBackgroundColor" | "viewBackgroundPattern"
  >,
  changes: Partial<PageSetup>,
): PageSetupPatch {
  const pageSetup = updatePageSetup(appState.pageSetup, changes);
  if (
    changes.paperTheme === undefined ||
    changes.paperTheme === appState.pageSetup?.paperTheme
  ) {
    return { pageSetup };
  }
  const colors = PAPER_THEME_COLORS[pageSetup.paperTheme];
  const pattern = appState.viewBackgroundPattern;
  return {
    pageSetup,
    viewBackgroundColor: colors.background,
    viewBackgroundPattern: pattern
      ? { ...pattern, color: colors.patternColor }
      : pattern,
  };
}
