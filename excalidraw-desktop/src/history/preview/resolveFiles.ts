/**
 * Image files of a history version. The stored JSON carries
 * `data:<mime>;base64,@vdblob:<sha>.<ext>` in place of the payload (codec.rs
 * strip); the bytes come from `readBlob`. The main editor's files win, so
 * images it already holds cost no IPC.
 */
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

import type { HistoryRepository } from "../types";

export interface RawFileEntry {
  mimeType?: string;
  dataURL?: string;
  created?: number;
}
export type RawFiles = Record<string, RawFileEntry>;

const TOKEN = /^(data:[^,]*,)@vdblob:([0-9a-f]{64}\.[a-z0-9]+)$/;

const toBase64 = (bytes: Uint8Array): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(new Blob([bytes as BlobPart]));
  });

const aborted = () => new DOMException("Aborted", "AbortError");

export interface ResolveFilesDeps {
  repository: HistoryRepository;
  handle: string;
  mainFiles: () => BinaryFiles | undefined;
  signal?: AbortSignal;
}

export const resolveFiles = async (
  ids: readonly string[],
  raw: RawFiles,
  deps: ResolveFilesDeps,
): Promise<BinaryFiles> => {
  const { repository, handle, signal } = deps;
  const main = deps.mainFiles() ?? {};
  const out: BinaryFiles = {};
  await Promise.all(
    ids.map(async (id) => {
      if (main[id]) {
        out[id] = main[id];
        return;
      }
      const entry = raw[id];
      if (!entry?.dataURL) {
        return;
      }
      let dataURL = entry.dataURL;
      const token = TOKEN.exec(dataURL);
      if (token) {
        const bytes = await repository.readBlob(handle, token[2]);
        if (signal?.aborted) {
          throw aborted();
        }
        dataURL = token[1] + (await toBase64(bytes));
      }
      out[id] = {
        id,
        mimeType: entry.mimeType ?? dataURL.slice(5, dataURL.indexOf(";")),
        dataURL,
        created: entry.created ?? 0,
      } as BinaryFileData;
    }),
  );
  if (signal?.aborted) {
    throw aborted();
  }
  return out;
};
