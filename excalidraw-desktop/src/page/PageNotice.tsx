import "./page.css";

type Props = {
  count: number;
  onFit: () => void;
  onDismiss: () => void;
};

/** Page mode on an old drawing: some content lies outside the pages. */
export function PageNotice({ count, onFit, onDismiss }: Props) {
  return (
    <div className="page-notice" role="status">
      <span className="page-notice-text">
        {count === 1
          ? "1 element is outside the page"
          : `${count} elements are outside the page`}
      </span>
      <button type="button" className="page-notice-action" onClick={onFit}>
        Fit content to page
      </button>
      <button
        type="button"
        className="page-notice-dismiss"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
