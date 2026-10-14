import type { TemplateEntry } from "./types";

const isWordStart = (s: string, i: number) =>
  i === 0 || /[\s\-_./()[\]]/.test(s[i - 1]);

/** Lower is better; -1 means no match. */
export const matchTier = (name: string, query: string): number => {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.startsWith(q)) {
    return 0;
  }
  let from = 0;
  let idx = n.indexOf(q, from);
  let sub = false;
  while (idx !== -1) {
    if (isWordStart(n, idx)) {
      return 1;
    }
    sub = true;
    from = idx + 1;
    idx = n.indexOf(q, from);
  }
  if (sub) {
    return 2;
  }
  let qi = 0;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length ? 3 : -1;
};

/** Ranks prefix > word-prefix > substring > subsequence; stable within a tier. */
export const filterTemplates = (
  entries: TemplateEntry[],
  query: string,
): TemplateEntry[] => {
  const q = query.trim();
  if (!q) {
    return entries;
  }
  const tiers: TemplateEntry[][] = [[], [], [], []];
  for (const entry of entries) {
    const tier = matchTier(entry.name, q);
    if (tier >= 0) {
      tiers[tier].push(entry);
    }
  }
  return tiers.flat();
};
