/**
 * Packaged-app smoke for file history (H2): a drawing gets a checkpoint, the
 * checkpoint is restored as a copy, and the copy is byte-exact (its revision
 * equals the original's and the version's `fileRevision`).
 */
import { DesktopHistoryRepository } from "../history/DesktopHistoryRepository";
import {
  HISTORY_DEFAULTS,
  toHistorySettings,
} from "../history/historySettings";

export type HistorySmokeContext = {
  handle: string;
  runId: string;
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

const scene = (value: string) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "desktop-smoke",
    elements: [
      {
        id: "t0",
        type: "text",
        x: 0,
        y: 0,
        width: 200,
        height: 20,
        text: value,
        originalText: value,
        isDeleted: false,
      },
    ],
    appState: {},
    files: {},
  });

export async function runHistorySmoke(ctx: HistorySmokeContext): Promise<void> {
  const { handle, runId, step, invoke } = ctx;
  await step("history-checkpoint-restore-copy-revisions-equal", async () => {
    const dir = `smoke-history-${runId}`;
    const path = `${dir}/drawing-${runId}.excalidraw`;
    const history = new DesktopHistoryRepository();
    await invoke("create_folder", { handle, path: dir });
    const written = (await invoke("write_drawing", {
      handle,
      path,
      json: scene("history smoke"),
      expectedRevision: null,
      operationId: "smoke-history-write",
    })) as { revision: string };

    await history.configure(handle, toHistorySettings(HISTORY_DEFAULTS));
    const version = await history.checkpoint(
      handle,
      path,
      "smoke checkpoint",
      "",
    );
    const read = await history.readVersion(handle, version.id);
    if (read.meta.fileRevision !== written.revision) {
      throw new Error(
        `checkpoint revision ${read.meta.fileRevision} differs from the file's ${written.revision}`,
      );
    }
    const copy = await history.restoreCopy(handle, version.id);
    if (copy.path === path) {
      throw new Error("restore as copy must create a new file");
    }
    const onDisk = (await invoke("read_drawing", {
      handle,
      path: copy.path,
    })) as { json: string; revision: string };
    if (
      copy.revision !== written.revision ||
      onDisk.revision !== copy.revision
    ) {
      throw new Error(
        `revisions differ: file ${written.revision}, copy ${copy.revision}, on disk ${onDisk.revision}`,
      );
    }
    return { versionId: version.id, copy: copy.path, revision: copy.revision };
  });
}
