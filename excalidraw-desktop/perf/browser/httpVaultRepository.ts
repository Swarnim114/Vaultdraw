import type {
  DrawingFile,
  RecoveryEntry,
  VaultChange,
  VaultEntry,
  VaultInfo,
  VaultRepository,
} from "../../src/vault/types";

export type IndexEntry = {
  path: string;
  kind: "folder" | "drawing";
  name: string;
  size?: number;
};

class PerfVaultError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/**
 * Perf-only repository: the vault tree comes from `<base>/index.json`, drawing
 * bodies are fetched from `<base>/<path>` on demand, writes stay in memory.
 */
export class HttpVaultRepository implements VaultRepository {
  readonly vault: VaultInfo = {
    handle: "perf",
    path: "/perf-vault",
    name: "Perf Vault",
    readOnly: false,
  };
  private children = new Map<string, VaultEntry[]>();
  private revisions = new Map<string, string>();
  private written = new Map<string, string>();
  private counter = 0;

  private constructor(private base: string) {}

  static async create(base: string): Promise<HttpVaultRepository> {
    const repo = new HttpVaultRepository(base);
    const response = await fetch(`${base}/index.json`);
    const index = (await response.json()) as IndexEntry[];
    for (const entry of index) {
      const parent = parentOf(entry.path);
      let list = repo.children.get(parent);
      if (!list) {
        list = [];
        repo.children.set(parent, list);
      }
      list.push({
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        modifiedAt: 1700000000000,
        size: entry.size ?? 0,
      });
    }
    for (const list of repo.children.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return repo;
  }

  private revisionFor(path: string): string {
    let revision = this.revisions.get(path);
    if (!revision) {
      revision = `rev-${++this.counter}`;
      this.revisions.set(path, revision);
    }
    return revision;
  }

  async chooseVault() {
    return { ...this.vault };
  }
  async reopenVault() {
    return null;
  }
  async releaseVault() {}
  async listDirectory(_handle: string, path: string) {
    return [...(this.children.get(path) ?? [])];
  }
  async readDrawing(_handle: string, path: string): Promise<DrawingFile> {
    let json = this.written.get(path);
    if (json === undefined) {
      const url = `${this.base}/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new PerfVaultError("NOT_FOUND", `drawing not found: ${path}`);
      }
      json = await response.text();
    }
    return { json, revision: this.revisionFor(path) };
  }
  // Arrow property: scenarios wrap/restore a detached reference to this method.
  writeDrawing = async (input: {
    handle: string;
    path: string;
    json: string;
    expectedRevision: string | null;
    operationId: string;
  }) => {
    const known = this.revisions.get(input.path);
    if (input.expectedRevision === null) {
      if (known || this.written.has(input.path)) {
        throw new PerfVaultError("NAME_COLLISION", `exists: ${input.path}`);
      }
    } else if (known && known !== input.expectedRevision) {
      // eslint-disable-next-line no-console
      console.log(
        `[perf] write conflict ${input.path}: expected ${input.expectedRevision}, have ${known}`,
      );
      throw new PerfVaultError("CONFLICT", `revision mismatch: ${input.path}`);
    }
    this.written.set(input.path, input.json);
    const revision = `rev-${++this.counter}`;
    this.revisions.set(input.path, revision);
    return { revision };
  };

  async createFolder() {}
  async move() {}
  async trash() {}
  async reveal() {}
  async exportFile() {
    return true;
  }
  async saveDrawingCopy() {
    return true;
  }
  async listRecovery(): Promise<RecoveryEntry[]> {
    return [];
  }
  async discardRecovery() {}
  async subscribe(_listener: (event: VaultChange) => void) {
    return () => {};
  }
}
