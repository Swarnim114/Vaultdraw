/** Folders to expand so the row of `path` is visible in the navigator tree. */
export const ancestorFolders = (path: string): string[] => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};
