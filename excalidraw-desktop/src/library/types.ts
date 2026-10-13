export type LibraryScope = "personal" | "vault";

export type LibraryReadResult = {
  /** null when the file does not exist, or when `unchanged` is true. */
  json: string | null;
  /** null when the file does not exist. */
  revision: string | null;
  /** The caller's knownRevision is still current: nothing was transferred. */
  unchanged: boolean;
  path: string;
  readOnly: boolean;
};

export type LibraryChange = { scope: LibraryScope; handle?: string };

export interface LibraryRepository {
  readLibrary(
    scope: LibraryScope,
    handle: string | null,
    knownRevision: string | null,
  ): Promise<LibraryReadResult>;
  /** expectedRevision null = create only. Rejects with code CONFLICT on mismatch. */
  writeLibrary(
    scope: LibraryScope,
    handle: string | null,
    json: string,
    expectedRevision: string | null,
  ): Promise<{ revision: string }>;
  /** null = cancelled. */
  pickLibraryFile(): Promise<{ name: string; json: string } | null>;
  exportFile(name: string, bytes: Uint8Array): Promise<boolean>;
  subscribe(listener: (event: LibraryChange) => void): Promise<() => void>;
}
