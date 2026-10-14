/**
 * Owns the template picker's open/listing state so opening it re-renders only
 * the picker, not VaultApp (navigator tree, header, editor props).
 */
import { useCallback, useImperativeHandle, useRef, useState } from "react";

import { errorMessage } from "../vault/types";

import { listTemplates, type TemplateDeps } from "./listTemplates";
import { TemplatePicker, type TemplatePickerProps } from "./TemplatePicker";

import type { Ref } from "react";
import type { TemplateEntry } from "./types";

export interface TemplatePickerHandle {
  open(): void;
}

interface Listing {
  vault: TemplateEntry[];
  global: TemplateEntry[];
  error?: string;
}

type PassThrough = Pick<
  TemplatePickerProps,
  | "ownerDocument"
  | "vaultName"
  | "templatesFolder"
  | "renderThumbnail"
  | "cancelThumbnail"
  | "onRevealGlobal"
>;

interface Props extends PassThrough {
  ref: Ref<TemplatePickerHandle>;
  deps: TemplateDeps;
  onPick(t: TemplateEntry): void;
  /** Omitted for read-only vaults: no Blank drawing row. */
  onBlank?(): void;
}

export function TemplatePickerHost({
  ref,
  deps,
  onPick,
  onBlank,
  ...pickerProps
}: Props) {
  const [picker, setPicker] = useState<{
    loading: boolean;
    data: Listing;
  } | null>(null);
  const generation = useRef(0);

  const open = useCallback(async () => {
    const mine = ++generation.current;
    setPicker({ loading: true, data: { vault: [], global: [] } });
    let data: Listing;
    try {
      const r = await listTemplates(deps);
      data = { vault: r.vault, global: r.global, error: r.vaultError };
    } catch (err) {
      data = { vault: [], global: [], error: errorMessage(err) };
    }
    if (mine === generation.current) {
      setPicker({ loading: false, data });
    }
  }, [deps]);

  const close = useCallback(() => {
    generation.current++;
    setPicker(null);
  }, []);

  useImperativeHandle(ref, () => ({ open: () => void open() }), [open]);

  if (!picker) {
    return null;
  }
  return (
    <TemplatePicker
      {...pickerProps}
      vaultTemplates={picker.data.vault}
      globalTemplates={picker.data.global}
      loading={picker.loading}
      error={picker.data.error}
      onPick={(t) => {
        close();
        onPick(t);
      }}
      onBlank={
        onBlank
          ? () => {
              close();
              onBlank();
            }
          : undefined
      }
      onClose={close}
    />
  );
}
