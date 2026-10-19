import { IconDrawing } from "../../components/Icons";
import { useThumbnailService } from "../context";
import { Thumbnail } from "../Thumbnail";

import { useThumbDarkClass } from "./darkInvert";

import "./RecentDrawings.css";

import type { HomeRecent } from "../../components/VaultHome";

/**
 * The vault home "Recent" block: tiles with thumbnails, or the plain text rows
 * when thumbnails are off or unavailable.
 */
export const RecentDrawings = ({
  entries,
  onOpen,
}: {
  entries: readonly HomeRecent[];
  onOpen: (path: string) => unknown;
}) => {
  const tiles = useThumbnailService() !== null;
  const dark = useThumbDarkClass();
  if (entries.length === 0) {
    return null;
  }
  return (
    <section
      className={`vault-recent${tiles ? ` vault-recent--tiles ${dark}` : ""}`}
      aria-label="Recent drawings"
    >
      <h3 className="vault-recent__title">Recent</h3>
      <div className={tiles ? "vault-recent__grid" : "vault-recent__list"}>
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className="vault-recent__item"
            onClick={() => void onOpen(entry.path)}
            title={entry.path}
          >
            {tiles ? (
              <Thumbnail path={entry.path} size="md" />
            ) : (
              <IconDrawing />
            )}
            <span className="vault-recent__name">{entry.name}</span>
            <span className="vault-recent__folder">{entry.folder}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
