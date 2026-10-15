/** `vaultdraw://open?file=<target>`: encodeURIComponent, but `/` stays readable. */
export const VAULT_URL_PREFIX = "vaultdraw://open";

export function encodeVaultUrl(target: string): string {
  return `${VAULT_URL_PREFIX}?file=${encodeURIComponent(target).replace(
    /%2F/gi,
    "/",
  )}`;
}

/** The target of a vaultdraw URL (`file=` or the older `path=`), or null. */
export function decodeVaultUrl(url: string): string | null {
  if (!url.startsWith(VAULT_URL_PREFIX)) {
    return null;
  }
  const rest = url.slice(VAULT_URL_PREFIX.length);
  if (!rest.startsWith("?")) {
    return null;
  }
  const hash = rest.indexOf("#");
  const query = rest.slice(1, hash < 0 ? undefined : hash);
  let found: string | null = null;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if ((key === "file" || key === "path") && eq >= 0 && found === null) {
      try {
        found = decodeURIComponent(pair.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return found ? found : null;
}
