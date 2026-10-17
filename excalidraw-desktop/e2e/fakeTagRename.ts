import { findTags, keyUnder, tagKey } from "../src/tags/grammar";

import type { ElementEdit, RewriteDone, VaultLinks } from "../src/links/types";
import type { FakeVaultRepository } from "../src/tests/fakeVaultRepository";
import type { TagRenamePlan, VaultTagRename } from "../src/tags/types";

/**
 * Harness-only VaultTagRename (?tagrename=1): a plain scan/rewrite over the
 * in-memory vault with the native semantics (children follow, the open
 * drawing gets undoable edits, closed drawings are rewritten in the
 * background and the rewrite-done event fires on the fake links).
 */
export class E2ETagRename implements VaultTagRename {
  private jobs = 0;
  constructor(
    private readonly repo: FakeVaultRepository,
    private readonly links: VaultLinks,
  ) {}

  private static rewrite(text: string, from: string, to: string) {
    let out = text;
    let n = 0;
    for (const m of findTags(text).reverse()) {
      if (keyUnder(tagKey(m.display), from)) {
        out =
          out.slice(0, m.start + 1) +
          to +
          m.display.slice(from.length) +
          out.slice(m.end);
        n++;
      }
    }
    return { out, n };
  }

  private async drawings(handle: string): Promise<[string, any][]> {
    const rows: [string, any][] = [];
    for (const path of [...(this.repo as any).files.keys()]) {
      rows.push([
        path,
        JSON.parse((await this.repo.readDrawing(handle, path)).json),
      ]);
    }
    return rows;
  }

  async plan(handle: string, from: string, to: string): Promise<TagRenamePlan> {
    let files = 0;
    let occurrences = 0;
    const keys = new Set<string>();
    let merges = false;
    for (const [, doc] of await this.drawings(handle)) {
      let hit = false;
      for (const el of doc.elements) {
        if (el.isDeleted || typeof el.text !== "string") {
          continue;
        }
        for (const m of findTags(el.text)) {
          const key = tagKey(m.display);
          if (keyUnder(key, from)) {
            hit = true;
            occurrences++;
            keys.add(key);
          } else if (key === tagKey(to)) {
            merges = true;
          }
        }
      }
      files += hit ? 1 : 0;
    }
    return {
      from,
      to,
      files,
      occurrences,
      merges,
      keys: [...keys].sort().map((k) => ({
        from: k,
        to: tagKey(to) + k.slice(from.length),
      })),
    };
  }

  async rename(
    handle: string,
    from: string,
    to: string,
    openPath: string | null,
  ) {
    const openDrawingEdits: ElementEdit[] = [];
    const closed: [string, any][] = [];
    let tokens = 0;
    for (const [path, doc] of await this.drawings(handle)) {
      let changed = false;
      for (const el of doc.elements) {
        if (el.isDeleted || typeof el.text !== "string") {
          continue;
        }
        const { out, n } = E2ETagRename.rewrite(el.text, from, to);
        if (n === 0) {
          continue;
        }
        tokens += n;
        changed = true;
        if (path === openPath) {
          openDrawingEdits.push({
            elementId: el.id,
            field: "text",
            value: out,
          });
        } else {
          el.text = out;
          el.originalText = out;
        }
      }
      if (changed && path !== openPath) {
        closed.push([path, doc]);
      }
    }
    const jobId = closed.length > 0 ? ++this.jobs : null;
    if (jobId !== null) {
      void (async () => {
        await Promise.resolve();
        for (const [path, doc] of closed) {
          const cur = await this.repo.readDrawing(handle, path);
          await this.repo.writeDrawing({
            handle,
            path,
            json: JSON.stringify(doc),
            expectedRevision: cur.revision,
            operationId: `tag-rename-${jobId}-${path}`,
          });
        }
        const done: RewriteDone = {
          handle,
          jobId,
          rewritten: closed.length,
          links: tokens,
          failed: [],
          tookMs: 1,
        };
        for (const l of [...((this.links as any).listeners as Set<any>)]) {
          l(done);
        }
      })();
    }
    return {
      jobId,
      plannedFiles: closed.length,
      plannedLinks: tokens,
      openDrawingEdits,
    };
  }
}
