/**
 * Link grammar, a port of src-tauri/src/links/grammar.rs (keep them in sync;
 * both pass src-tauri/src/links/fixtures/grammar.json). Offsets are UTF-16.
 *
 * - Text: `[[target]]` and `[[target|label]]` on one line, `.excalidraw`
 *   dropped from the target, at most MAX_LINK_CHARS inside the brackets.
 * - Link field: `[[x]]`, `vaultdraw://open?file=x`, `./x.excalidraw`,
 *   `x.excalidraw`. Anything else (web URLs, `/...`) is not a vault link.
 */
import { decodeVaultUrl, VAULT_URL_PREFIX } from "./linkUri";

export const MAX_LINK_CHARS = 256;

export type LinkSpan = {
  /** UTF-16 [start, end) of the whole `[[...]]` token. */
  start: number;
  end: number;
  target: string;
  label: string | null;
};

export type LinkField = { target: string; relative?: boolean };

const EXTENSION = /\.excalidraw$/i;

export const stripExtension = (target: string) => target.replace(EXTENSION, "");

/** `inner` of `[[inner]]` -> target/label, or null when it is not a link. */
function parseInner(
  inner: string,
): { target: string; label: string | null } | null {
  if (inner.length > MAX_LINK_CHARS) {
    return null;
  }
  const bar = inner.indexOf("|");
  const rawTarget = bar < 0 ? inner : inner.slice(0, bar);
  const target = stripExtension(rawTarget.trim());
  if (!target) {
    return null;
  }
  const label = bar < 0 ? null : inner.slice(bar + 1).trim();
  return { target, label: label ? label : null };
}

/** All `[[...]]` links in `text`, in order. */
export function findLinks(text: string): LinkSpan[] {
  const out: LinkSpan[] = [];
  let from = text.indexOf("[[");
  while (from >= 0) {
    const close = text.indexOf("]]", from + 2);
    if (close < 0) {
      break;
    }
    const inner = text.slice(from + 2, close);
    const nl = inner.indexOf("\n");
    const nested = inner.lastIndexOf("[[");
    if (nl >= 0) {
      // A newline ends any link opened before it.
      from = text.indexOf("[[", from + 2 + nl);
      continue;
    }
    if (nested >= 0) {
      from = from + 2 + nested;
      continue;
    }
    const parsed = parseInner(inner);
    if (parsed) {
      out.push({ start: from, end: close + 2, ...parsed });
      from = text.indexOf("[[", close + 2);
    } else {
      from = text.indexOf("[[", from + 2);
    }
  }
  return out;
}

/** The target of an element `link` field, or null when it is not a vault link. */
export function parseLinkField(
  link: string | null | undefined,
): LinkField | null {
  const raw = link?.trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("[[")) {
    const first = findLinks(raw)[0];
    return first ? { target: first.target } : null;
  }
  if (raw.startsWith(VAULT_URL_PREFIX)) {
    const target = decodeVaultUrl(raw);
    return target ? { target: stripExtension(target) } : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/")) {
    return null;
  }
  if (EXTENSION.test(raw)) {
    return { target: stripExtension(raw), relative: true };
  }
  return null;
}
