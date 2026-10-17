import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { FORMULA_COMMAND_IDS } from "./formulaCommands";
import { getFormulaData } from "./types";

import type { ReactNode, RefObject } from "react";

import type { RenderedFormula } from "./insertFormula";
import type { FormulaData } from "./types";

const FormulaDialog = lazy(() => import("./FormulaDialog"));
// Insert/replace (hash, base64, element building) loads with the dialog's
// chunk, not at startup.
const loadInsert = () => import("./insertFormula");

type Target = { element: ExcalidrawImageElement; data: FormulaData };
type DialogState =
  | { mode: "insert"; color: string }
  | ({ mode: "edit" } & Target);

type Options = {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  readOnly?: boolean;
  getOwnerDocument?: () => Document | null | undefined;
};

/** Exactly one selected, unlocked formula image, else null. */
export function getSelectedFormula(
  api: ExcalidrawImperativeAPI,
): Target | null {
  const ids = Object.keys(api.getAppState().selectedElementIds);
  if (ids.length !== 1) {
    return null;
  }
  const el = api
    .getSceneElements()
    .find((e) => e.id === ids[0] && e.type === "image");
  return el ? formulaTarget(el as ExcalidrawImageElement) : null;
}

function formulaTarget(el: ExcalidrawImageElement): Target | null {
  const data = getFormulaData(el);
  return data && !el.locked ? { element: el, data } : null;
}

export function useFormulaCommands({
  apiRef,
  readOnly = false,
  getOwnerDocument,
}: Options): {
  onImageEdit: (el: ExcalidrawImageElement) => boolean;
  dialog: ReactNode;
} {
  const [state, setState] = useState<DialogState | null>(null);
  const live = useRef({ readOnly, getOwnerDocument });
  live.current = { readOnly, getOwnerDocument };

  const openEdit = useCallback((target: Target) => {
    setState({ mode: "edit", ...target });
  }, []);

  const onImageEdit = useCallback(
    (el: ExcalidrawImageElement) => {
      const api = apiRef.current;
      if (!api || live.current.readOnly || api.getAppState().viewModeEnabled) {
        return false;
      }
      const target = formulaTarget(el);
      if (!target) {
        return false;
      }
      openEdit(target);
      return true;
    },
    [apiRef, openEdit],
  );

  useEffect(
    () =>
      registerCommandHandlers({
        [FORMULA_COMMAND_IDS.insert]: () => {
          const api = apiRef.current;
          if (!api || live.current.readOnly) {
            return;
          }
          setState({
            mode: "insert",
            color: api.getAppState().currentItemStrokeColor,
          });
        },
        [FORMULA_COMMAND_IDS.edit]: () => {
          const api = apiRef.current;
          const target =
            api && !live.current.readOnly && getSelectedFormula(api);
          if (target) {
            openEdit(target);
          }
        },
      }),
    [apiRef, openEdit],
  );

  const close = useCallback(() => setState(null), []);

  const confirm = useCallback(
    (formula: RenderedFormula) => {
      const api = apiRef.current;
      const current = state;
      setState(null);
      if (!api || !current) {
        return;
      }
      if (current.mode === "insert") {
        void loadInsert().then((m) => m.insertFormula(api, formula));
        return;
      }
      // Re-read: the element may have changed or gone while the dialog was open.
      const el = api
        .getSceneElements()
        .find((e) => e.id === current.element.id);
      const target = el && formulaTarget(el as ExcalidrawImageElement);
      if (target) {
        void loadInsert().then((m) =>
          m.replaceFormula(api, target.element, target.data, formula),
        );
      }
    },
    [apiRef, state],
  );

  const dialog = useMemo(
    () =>
      state ? (
        <Suspense fallback={null}>
          <FormulaDialog
            mode={state.mode}
            initialSource={state.mode === "edit" ? state.data.source : ""}
            initialDisplay={state.mode === "edit" ? state.data.display : true}
            color={state.mode === "edit" ? state.data.color : state.color}
            onConfirm={confirm}
            onCancel={close}
            ownerDocument={live.current.getOwnerDocument?.()}
          />
        </Suspense>
      ) : null,
    [state, confirm, close],
  );

  return { onImageEdit, dialog };
}
