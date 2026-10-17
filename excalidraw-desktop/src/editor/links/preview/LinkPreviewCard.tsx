import "./preview.css";

export interface LinkPreviewCardProps {
  /** Link target as written, shown for unresolved links. */
  target: string;
  /** Resolved drawing name and folder; null when the target does not exist. */
  name: string | null;
  folder: string | null;
  /** undefined while loading, null when there is none (too big, empty). */
  thumbnail: string | null | undefined;
  modifierLabel: string;
  left: number;
  top: number;
}

export default function LinkPreviewCard({
  target,
  name,
  folder,
  thumbnail,
  modifierLabel,
  left,
  top,
}: LinkPreviewCardProps) {
  const resolved = name !== null;
  return (
    <div
      className="vault-link-preview"
      role="tooltip"
      style={{ left, top }}
      data-testid="link-preview"
    >
      {resolved ? (
        <>
          <div className="vault-link-preview__name">{name}</div>
          <div className="vault-link-preview__meta">{folder}</div>
          <div className="vault-link-preview__thumb">
            {thumbnail ? (
              <img src={thumbnail} alt="" draggable={false} />
            ) : (
              <div
                className="vault-link-preview__placeholder"
                data-testid="link-preview-placeholder"
              />
            )}
          </div>
          <div className="vault-link-preview__keys">
            {modifierLabel}-click to open
          </div>
        </>
      ) : (
        <>
          <div className="vault-link-preview__name">
            No drawing named {target}
          </div>
          <div className="vault-link-preview__keys">
            {modifierLabel}-click to create
          </div>
        </>
      )}
    </div>
  );
}
