/**
 * Template flows for VaultApp: "New from template…" picker and "Save as
 * template". Keeps state and dialogs out of VaultApp; the app supplies the
 * few things only it can do (create a document, flush, report errors).
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import {
  errorMessage,
  type VaultInfo,
  type VaultRepository,
} from "../vault/types";

import { createGlobalTemplateStore } from "./globalTemplates";
import { instantiateTemplate } from "./instantiate";
import { listTemplates, readTemplateJson } from "./listTemplates";
import { saveAsTemplate } from "./saveTemplate";
import { SaveTemplateModal, type TemplateScope } from "./SaveTemplateModal";
import { TemplatePicker } from "./TemplatePicker";
import { createThumbnailRenderer } from "./thumbnails";
import { templateKey, type TemplateEntry } from "./types";

import type { GlobalTemplateStore } from "./types";

interface Options {
  repository: VaultRepository;
  vault: VaultInfo | null;
  folder: string;
  doc: Document | null;
  theme: "light" | "dark";
  activePath: string | null;
  flushActive: () => Promise<void>;
  /** Resolves (and creates) the parent folder for a new drawing; null = abort. */
  prepareParent: () => Promise<string | null>;
  createFromJson: (parent: string, name: string, json: string) => Promise<void>;
  newBlank: () => void;
  onError: (message: string) => void;
}

interface Listing {
  vault: TemplateEntry[];
  global: TemplateEntry[];
  error?: string;
}

export function useTemplates(o: Options) {
  const globalStore = useRef<GlobalTemplateStore | null>(null);
  globalStore.current ??= createGlobalTemplateStore();
  const renderer = useRef<ReturnType<typeof createThumbnailRenderer> | null>(
    null,
  );
  renderer.current ??= createThumbnailRenderer();

  const [picker, setPicker] = useState<{
    loading: boolean;
    data: Listing;
  } | null>(null);
  const [saveTarget, setSaveTarget] = useState<string | null>(null);
  const generation = useRef(0);
  const { vault, folder, repository } = o;

  const deps = useMemo(
    () =>
      vault
        ? {
            repository,
            handle: vault.handle,
            folder,
            global: globalStore.current!,
          }
        : null,
    [vault, folder, repository],
  );

  const openPicker = useCallback(async () => {
    if (!deps) {
      return;
    }
    const mine = ++generation.current;
    setPicker({ loading: true, data: { vault: [], global: [] } });
    try {
      const r = await listTemplates(deps);
      if (mine === generation.current) {
        setPicker({
          loading: false,
          data: { vault: r.vault, global: r.global, error: r.vaultError },
        });
      }
    } catch (err) {
      if (mine === generation.current) {
        setPicker({
          loading: false,
          data: { vault: [], global: [], error: errorMessage(err) },
        });
      }
    }
  }, [deps]);

  const closePicker = useCallback(() => {
    generation.current++;
    setPicker(null);
  }, []);

  const pick = useCallback(
    async (entry: TemplateEntry) => {
      if (!deps) {
        return;
      }
      closePicker();
      try {
        const json = instantiateTemplate(await readTemplateJson(entry, deps), {
          theme: o.theme,
        });
        const parent = await o.prepareParent();
        if (parent === null) {
          return;
        }
        const stamp = Date.now().toString().slice(-4);
        await o.createFromJson(
          parent,
          `${entry.name}-${stamp}.excalidraw`,
          json,
        );
      } catch (err) {
        o.onError(`Failed to create from template: ${errorMessage(err)}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps, closePicker, o.theme, o.prepareParent, o.createFromJson, o.onError],
  );

  const requestSave = useCallback((path: string | null) => {
    if (path) {
      setSaveTarget(path);
    }
  }, []);

  const save = async (name: string, scope: TemplateScope) => {
    if (!deps || !saveTarget) {
      return;
    }
    if (saveTarget === o.activePath) {
      await o.flushActive();
    }
    const file = await repository.readDrawing(deps.handle, saveTarget);
    await saveAsTemplate({ ...deps, scope, name, json: file.json });
    setSaveTarget(null);
  };

  const dialogs: ReactNode = (
    <>
      {picker && o.doc && vault && (
        <TemplatePicker
          ownerDocument={o.doc}
          vaultName={vault.name}
          vaultTemplates={picker.data.vault}
          globalTemplates={picker.data.global}
          loading={picker.loading}
          error={picker.data.error}
          templatesFolder={folder}
          renderThumbnail={(t) =>
            renderer.current!.request(templateKey(t), () =>
              readTemplateJson(t, deps!),
            )
          }
          cancelThumbnail={(t) => renderer.current!.cancel(templateKey(t))}
          onPick={(t) => void pick(t)}
          onBlank={
            vault.readOnly
              ? undefined
              : () => {
                  closePicker();
                  o.newBlank();
                }
          }
          onClose={closePicker}
          onRevealGlobal={() => void globalStore.current!.reveal()}
        />
      )}
      {saveTarget && vault && (
        <SaveTemplateModal
          defaultName={saveTarget
            .split("/")
            .pop()!
            .replace(/\.excalidraw$/i, "")}
          ownerDocument={o.doc}
          readOnlyVault={vault.readOnly}
          onSave={save}
          onCancel={() => setSaveTarget(null)}
        />
      )}
    </>
  );

  return { openPicker, requestSave, dialogs, pickerOpen: picker !== null };
}
