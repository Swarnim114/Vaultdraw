import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import {
  applyFitContent,
  createPageHandlers,
  createPageNavigationHandlers,
} from "./pageCommands";
import { PageRuntime } from "./pageRuntime";

import type { RefObject } from "react";

type Options = {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  getWindow: () => Window | null;
  disabled: boolean;
  readOnly: boolean;
  openPageSetup: () => void;
};

/**
 * Page mode of the open editor: the runtime (view lock, enforcement,
 * auto-extend, paper display), the "Page" command handlers and the
 * "outside the page" notice. `onChange` goes into the editor's onChange.
 */
export function usePageMode(options: Options) {
  const live = useRef(options);
  live.current = options;
  const [outsideCount, setOutsideCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const runtime = useRef<PageRuntime | null>(null);

  useEffect(() => {
    const api = () => live.current.apiRef.current;
    // PageUp/PageDown belong to page navigation only while page mode is on;
    // otherwise they keep scrolling the infinite canvas.
    let unbindNavigation: (() => void) | null = null;
    const instance = new PageRuntime({
      onModeChange: (on) => {
        unbindNavigation?.();
        unbindNavigation = on
          ? registerCommandHandlers(createPageNavigationHandlers(api))
          : null;
      },
      getApi: api,
      isDisabled: () => live.current.disabled,
      onOutsideCount: (count) => {
        setOutsideCount(count);
        if (count === 0) {
          setDismissed(false);
        }
      },
    });
    runtime.current = instance;
    const unbind = registerCommandHandlers(
      createPageHandlers({
        getApi: api,
        getWindow: () => live.current.getWindow(),
        isDisabled: () => live.current.disabled,
        openPageSetup: () => live.current.openPageSetup(),
      }),
    );
    return () => {
      unbind();
      unbindNavigation?.();
      instance.dispose();
      runtime.current = null;
    };
  }, []);

  const onChange = useCallback<PageRuntime["onChange"]>((elements, state) => {
    runtime.current?.onChange(elements, state);
  }, []);

  const fitContent = useCallback(() => {
    const api = live.current.apiRef.current;
    if (api && !live.current.disabled) {
      applyFitContent(api);
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    onChange,
    notice:
      outsideCount > 0 && !dismissed && !options.readOnly && !options.disabled
        ? { count: outsideCount, onFit: fitContent, onDismiss: dismiss }
        : null,
  };
}
