/**
 * Packaged-app smoke for links (P1): two drawings, one linking to the other,
 * the backlink shows in the native index, a links-aware rename rewrites the
 * link on disk, and `links-rewrite-done` reports it.
 */
import { DesktopVaultLinks } from "../links/DesktopVaultLinks";

import type { RewriteDone } from "../links/types";

export type LinksSmokeContext = {
  win: Window & typeof globalThis;
  handle: string;
  runId: string;
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

const text = (id: string, value: string) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 200,
  height: 20,
  text: value,
  originalText: value,
  isDeleted: false,
});

const scene = (value: string) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "desktop-smoke",
    elements: [text("t0", value)],
    appState: {},
    files: {},
  });

export async function runLinksSmoke(ctx: LinksSmokeContext): Promise<void> {
  const { win, handle, runId, step, invoke } = ctx;
  await step("native-links-rename-rewrites", async () => {
    const dir = `smoke-links-${runId}`;
    const target = `${dir}/target-${runId}.excalidraw`;
    const source = `${dir}/source-${runId}.excalidraw`;
    const renamed = `${dir}/renamed-${runId}.excalidraw`;
    const links = new DesktopVaultLinks();
    const write = (path: string, value: string, op: string) =>
      invoke("write_drawing", {
        handle,
        path,
        json: scene(value),
        expectedRevision: null,
        operationId: op,
      });
    await invoke("create_folder", { handle, path: dir });
    await write(target, "the target", "smoke-links-target");
    await write(source, `see [[target-${runId}]]`, "smoke-links-source");

    const until = win.performance.now() + 10_000;
    for (;;) {
      const res = await links.links(handle, target);
      if (res.backlinks.some((b) => b.path === source)) {
        break;
      }
      if (win.performance.now() > until) {
        throw new Error("backlink never appeared in the link index");
      }
      await new Promise((r) => win.setTimeout(r, 200));
    }

    let done: (d: RewriteDone) => void = () => {};
    const finished = new Promise<RewriteDone>((resolve) => {
      done = resolve;
    });
    const off = await links.onRewriteDone(done);
    try {
      const moved = await links.moveWithLinks(
        handle,
        target,
        renamed,
        null,
        true,
      );
      if (moved.jobId !== null) {
        const result = await Promise.race([
          finished,
          new Promise<never>((_, reject) =>
            win.setTimeout(
              () => reject(new Error("links-rewrite-done never fired")),
              10_000,
            ),
          ),
        ]);
        if (result.failed.length > 0) {
          throw new Error(`rewrite failed: ${JSON.stringify(result.failed)}`);
        }
      }
    } finally {
      off();
    }
    const read = (await invoke("read_drawing", { handle, path: source })) as {
      json: string;
    };
    if (!read.json.includes(`[[renamed-${runId}]]`)) {
      throw new Error("source drawing was not rewritten on disk");
    }
    return { dir, rewritten: source };
  });
}
