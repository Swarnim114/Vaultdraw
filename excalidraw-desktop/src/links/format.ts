/** The text Vaultdraw writes for a link, per the user's link settings. */
import { stripExtension } from "./grammar";
import { encodeVaultUrl } from "./linkUri";
import { relativePath } from "./resolve";

import type { LinkResolver } from "./resolve";
import type { NewLinkFormat, ShapeLinkFormat } from "./types";

/** The target to put inside `[[...]]` for the drawing at `targetPath`. */
export function linkTargetFor(
  targetPath: string,
  fromPath: string | null,
  resolver: LinkResolver,
  format: NewLinkFormat,
): string {
  switch (format) {
    case "absolute":
      return stripExtension(targetPath);
    case "relative": {
      if (fromPath === null) {
        return stripExtension(targetPath);
      }
      const rel = stripExtension(relativePath(fromPath, targetPath));
      return rel.startsWith("../") ? rel : `./${rel}`;
    }
    default:
      return resolver.shortestTarget(targetPath);
  }
}

/** `[[target]]` or `[[target|label]]`. */
export const wikiLink = (target: string, label?: string | null) =>
  label ? `[[${target}|${label}]]` : `[[${target}]]`;

/** The value of an element's `link` field for `target`. */
export const shapeLinkValue = (target: string, format: ShapeLinkFormat) =>
  format === "vaultdraw-url" ? encodeVaultUrl(target) : wikiLink(target);
