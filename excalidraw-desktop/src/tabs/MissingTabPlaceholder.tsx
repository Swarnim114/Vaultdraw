/** Tabs: shown instead of the editor when the active tab's file is gone. */

export interface MissingTabPlaceholderProps {
  path: string;
  onClose: () => void;
  onSearch: () => void;
}

export const MissingTabPlaceholder = ({
  path,
  onClose,
  onSearch,
}: MissingTabPlaceholderProps) => (
  <div className="vault-tab-missing" data-testid="missing-tab-placeholder">
    <p className="vault-tab-missing__title">
      This drawing was moved or deleted outside Vaultdraw
    </p>
    <code className="vault-tab-missing__path">{path}</code>
    <div className="vault-tab-missing__actions">
      <button
        type="button"
        className="vault-tab-missing__btn"
        onClick={onClose}
      >
        Close tab
      </button>
      <button
        type="button"
        className="vault-tab-missing__btn vault-tab-missing__btn--primary"
        onClick={onSearch}
      >
        Search for it
      </button>
    </div>
  </div>
);
