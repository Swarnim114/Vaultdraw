/** Plain-language explanations for the scope switch, override notes and dots. */
import { describeReadOnly } from "../../vault/readOnlyReason";

import type { VaultInfo } from "../../vault/types";

export const CUSTOMISED_DOT_HELP = "This tool has customised defaults";

export const OVERRIDDEN_NOTE =
  "Overridden in this vault: the vault value is used here";

export const TOOLS_LEGEND_DOT = "Customised defaults";

export const TOOLS_LEGEND_UNSET =
  "Options you leave unset follow Excalidraw's last-used style";

export const SCOPE_SWITCH_HELP =
  "Global applies to every vault. This vault applies only here and wins over Global.";

/** Why "This vault" can't be chosen (with the read-only cause when known), or null. */
export const vaultScopeDisabledReason = (
  vault: Pick<
    VaultInfo,
    "readOnly" | "readOnlyReason" | "lockHolderPid"
  > | null,
): string | null => {
  if (!vault?.readOnly) {
    return null;
  }
  const summary = vault.readOnlyReason ? describeReadOnly(vault).summary : null;
  const cause = summary && summary[0].toLowerCase() + summary.slice(1);
  return `This vault is read-only${
    cause ? ` (${cause})` : ""
  }, so vault settings can't be saved`;
};

export const customisedTabTitle = (label: string, customised: boolean) =>
  customised ? `${label}: ${CUSTOMISED_DOT_HELP.toLowerCase()}` : label;
