import { useEffect, useRef } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { DEFAULT_SIDEBAR } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { selectPaperStyle } from "../components/paper/selectPaperStyle";
import { PAPER_STYLES } from "../components/paper/paperStyles";
import { paperCommandId } from "../commands/editorCommands";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { detectPlatform } from "../commands/keys";
import { registerPaletteProvider } from "../palette/registry";
import { createEditorProvider } from "../palette/providers/editor";
import { createPensProvider } from "../palette/providers/pens";
import { getPreferences } from "../vault/preferences";

import type { CommandHandlers } from "../commands/types";
import type { PenPreset } from "../pens/penPresets";

import type { RefObject } from "react";

type Options = {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  disabled: boolean;
  presets: readonly PenPreset[];
  activePen: number | null;
  selectPen: (index: number) => void;
  openPaperSettings: () => void;
};

/**
 * While the editor is mounted: its palette providers (editor commands, pens)
 * and the handlers of the editor-owned commands (paper, library). Everything
 * reads refs at call time, so nothing runs while the palette is closed.
 */
export function useEditorPalette(options: Options): void {
  const live = useRef(options);
  live.current = options;

  useEffect(() => {
    const platform = detectPlatform();
    const api = () => live.current.apiRef.current;

    const paper: CommandHandlers = Object.fromEntries(
      PAPER_STYLES.map((style) => [
        paperCommandId(style.id),
        () => {
          const current = api();
          if (
            !current ||
            live.current.disabled ||
            current.getAppState().viewModeEnabled
          ) {
            return;
          }
          const type = style.id === "plain" ? null : style.id;
          current.updateScene({
            appState: {
              viewBackgroundPattern: selectPaperStyle(
                type,
                current.getAppState().viewBackgroundPattern ?? null,
              ),
            },
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        },
      ]),
    );
    const unbind = registerCommandHandlers({
      ...paper,
      "paper.settings": () => live.current.openPaperSettings(),
      "library.toggle": () => {
        api()?.toggleSidebar(DEFAULT_SIDEBAR);
      },
    });
    const unEditor = registerPaletteProvider(
      createEditorProvider(api, {
        platform,
        disabled: () => live.current.disabled,
      }),
    );
    const unPens = registerPaletteProvider(
      createPensProvider({
        platform,
        presets: () => live.current.presets,
        overrides: () => getPreferences().hotkeys,
        active: () => live.current.activePen,
        select: (i) => live.current.selectPen(i),
      }),
    );
    return () => {
      unbind();
      unEditor();
      unPens();
    };
  }, []);
}
