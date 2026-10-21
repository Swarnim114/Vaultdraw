/** Plain-language explanations for the scope switch, override notes and dots. */

export const CUSTOMISED_DOT_HELP = "This tool has customised defaults";

export const OVERRIDDEN_NOTE =
  "Overridden in this vault: the vault value is used here";

export const TOOLS_LEGEND_DOT = "Customised defaults";

export const TOOLS_LEGEND_UNSET =
  "Options you leave unset follow Excalidraw's last-used style";

export const SCOPE_SWITCH_HELP =
  "Global applies to every vault. This vault applies only here and wins over Global.";

/** Why "This vault" can't be chosen, or null when it can. */
export const vaultScopeDisabledReason = (
  vault: { readOnly: boolean } | null,
): string | null =>
  vault?.readOnly
    ? "This vault is read-only, so vault settings can't be saved"
    : null;

export const customisedTabTitle = (label: string, customised: boolean) =>
  customised ? `${label}: ${CUSTOMISED_DOT_HELP.toLowerCase()}` : label;
