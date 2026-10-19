import { IconDrawing } from "../../components/Icons";
import { useThumbnailService } from "../context";
import { Thumbnail } from "../Thumbnail";

import "./SearchThumb.css";

/** Leading visual of a drawing search row: its thumbnail, else the icon. */
export const SearchThumb = ({ path }: { path: string }) =>
  useThumbnailService() ? (
    <span className="vault-search-row__thumb">
      <Thumbnail path={path} size="sm" />
    </span>
  ) : (
    <span className="vault-search-row__icon">
      <IconDrawing />
    </span>
  );
