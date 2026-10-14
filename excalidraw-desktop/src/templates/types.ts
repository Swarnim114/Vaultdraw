/** Shared types for templates (F9). */

export type TemplateSource = "vault" | "global";

export interface TemplateEntry {
  source: TemplateSource;
  /**
   * vault: path relative to the vault root ("Templates/Lecture.excalidraw").
   * global: bare file name inside ~/.config/vaultdraw/templates ("Lecture.excalidraw").
   */
  path: string;
  /** Display name: file name without ".excalidraw". */
  name: string;
  modifiedAt: number;
  size: number;
}

/** Stable cache key; changes when the file changes. */
export const templateKey = (t: TemplateEntry): string =>
  `${t.source}:${t.path}:${t.modifiedAt}:${t.size}`;

export interface GlobalTemplateInfo {
  name: string; // file name incl. ".excalidraw"
  modifiedAt: number;
  size: number;
}

/** Global templates folder (config dir). Native commands, or in-memory in a plain browser. */
export interface GlobalTemplateStore {
  list(): Promise<GlobalTemplateInfo[]>;
  read(name: string): Promise<string>;
  /** Create-only; rejects with code NAME_COLLISION when the name exists. */
  write(name: string, json: string): Promise<void>;
  /** Reveal the folder in the file manager (no-op in a browser). */
  reveal(): Promise<void>;
}

export const DEFAULT_TEMPLATES_FOLDER = "Templates";
