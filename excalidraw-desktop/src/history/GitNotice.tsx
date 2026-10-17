import { useState } from "react";

import { GIT_NOTICE_TEXT } from "./historyConfirms";
import { dismissGitNotice, isGitNoticeDismissed } from "./gitNoticeState";

import type { HistoryStatus } from "./types";

export interface GitNoticeProps {
  status: HistoryStatus | null;
  /** Key of "Not now" (the vault path; the handle when unknown). */
  vaultKey: string;
  disabled?: boolean;
  onExclude: () => void | Promise<void>;
  ownerWindow?: Window | null;
}

/** One-time note at the top of the panel in git vaults whose history is not excluded. */
export const GitNotice = ({
  status,
  vaultKey,
  disabled = false,
  onExclude,
  ownerWindow,
}: GitNoticeProps) => {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  if (
    !status?.gitRepo ||
    status.gitExcluded ||
    dismissedKey === vaultKey ||
    isGitNoticeDismissed(vaultKey, ownerWindow)
  ) {
    return null;
  }
  return (
    <div
      className="vault-history-panel__notice"
      role="note"
      data-testid="history-git-notice"
    >
      <p>{GIT_NOTICE_TEXT}</p>
      <div className="vault-history-panel__notice-actions">
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          disabled={disabled}
          onClick={() => void onExclude()}
        >
          Exclude history from git
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--sm"
          onClick={() => {
            dismissGitNotice(vaultKey, ownerWindow);
            setDismissedKey(vaultKey);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
};
