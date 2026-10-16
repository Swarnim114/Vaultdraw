/** Test double for VaultTagRename: scripted answers, recorded calls. */
import type { MoveResult } from "../links/types";
import type { TagRenamePlan, VaultTagRename } from "../tags/types";

export class FakeVaultTagRename implements VaultTagRename {
  planCalls: { handle: string; from: string; to: string }[] = [];
  renameCalls: {
    handle: string;
    from: string;
    to: string;
    openPath: string | null;
  }[] = [];
  planResult: (from: string, to: string) => TagRenamePlan | Error = (
    from,
    to,
  ) => ({
    from,
    to,
    files: 2,
    occurrences: 3,
    merges: false,
    keys: [{ from, to: to.toLowerCase() }],
  });
  renameResult: MoveResult | Error = {
    jobId: 7,
    plannedFiles: 2,
    plannedLinks: 3,
    openDrawingEdits: [],
  };

  async plan(handle: string, from: string, to: string) {
    this.planCalls.push({ handle, from, to });
    const r = this.planResult(from, to);
    if (r instanceof Error) {
      throw r;
    }
    return r;
  }

  async rename(
    handle: string,
    from: string,
    to: string,
    openPath: string | null,
  ) {
    this.renameCalls.push({ handle, from, to, openPath });
    if (this.renameResult instanceof Error) {
      throw this.renameResult;
    }
    return this.renameResult;
  }
}
