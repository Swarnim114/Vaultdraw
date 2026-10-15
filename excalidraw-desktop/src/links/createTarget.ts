/**
 * Where "Create <target>" puts a new drawing. A target with a folder path is
 * honoured relative to the vault root (`./` and `../` relative to the open
 * drawing); a bare name goes to `defaultParent` (the resolved
 * files.new_drawing_folder, or next to the open drawing).
 */
import { joinRelative, folderOf } from "./resolve";
import { stripExtension } from "./grammar";

export type CreateSpot = { parent: string; name: string };

/** Characters no file name may hold (kept out of the generated name). */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\\:*?"<>|\u0000-\u001f]/g;

export function createSpot(
  target: string,
  defaultParent: string,
  fromPath: string | null,
): CreateSpot | null {
  let clean = stripExtension(target.trim());
  let parent = defaultParent;
  if (clean.startsWith("./") || clean.startsWith("../")) {
    const joined = joinRelative(folderOf(fromPath ?? ""), clean);
    if (joined === null) {
      return null;
    }
    clean = joined;
    parent = "";
  }
  clean = clean.replace(/^\/+/, "");
  const slash = clean.lastIndexOf("/");
  const base = clean
    .slice(slash + 1)
    .replace(ILLEGAL, "")
    .trim();
  if (!base) {
    return null;
  }
  if (slash >= 0) {
    parent = clean
      .slice(0, slash)
      .split("/")
      .map((p) => p.replace(ILLEGAL, "").trim())
      .filter(Boolean)
      .join("/");
  }
  return { parent, name: `${base}.excalidraw` };
}
