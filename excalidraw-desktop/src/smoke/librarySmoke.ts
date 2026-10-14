/**
 * Packaged-app smoke for the persisted library (F10). Called from runDesktopSmoke.
 * Phase is decided by whether <config>/library.excalidrawlib exists at start:
 *   persist  (no file): add items through the real sidebar UI, assert both files.
 *   restore  (file present, e.g. second launch with the same config + vault dirs):
 *            assert the items are loaded without re-adding, then an external
 *            write is picked up live via library-change (and restored).
 */
type ReadResult = {
  json: string | null;
  revision: string | null;
  unchanged: boolean;
  path: string;
  readOnly: boolean;
};

type Scope = "personal" | "vault";

export type LibrarySmokeContext = {
  root: HTMLElement;
  doc: Document;
  win: Window & typeof globalThis;
  handle: string;
  startedAt: number;
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  waitFor: <T>(
    label: string,
    read: () => T | null | undefined,
    ms?: number,
  ) => Promise<T>;
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

export async function runLibrarySmoke(ctx: LibrarySmokeContext) {
  const { root, doc, win, handle, startedAt, step, waitFor, invoke } = ctx;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => win.setTimeout(resolve, ms));
  const now = () => win.performance.now();
  const read = (scope: Scope) =>
    invoke("read_library", {
      scope,
      handle: scope === "vault" ? handle : null,
      knownRevision: null,
    }) as Promise<ReadResult>;
  const write = (scope: Scope, json: string, expectedRevision: string | null) =>
    invoke("write_library", {
      scope,
      handle: scope === "vault" ? handle : null,
      json,
      expectedRevision,
    }) as Promise<{ revision: string }>;

  const header = (id: Scope) =>
    root.querySelector<HTMLElement>(`[data-testid="library-section-${id}"]`);
  const gridOf = (id: Scope) => header(id)?.nextElementSibling ?? null;
  /** Real items only: the pending "add" tile pulses and has an adder. */
  const tiles = (id: Scope) =>
    Array.from(
      gridOf(id)?.querySelectorAll<HTMLElement>(".library-unit__dragger") ?? [],
    ).filter((el) => !el.classList.contains("library-unit__pulse")).length;
  const adder = (id: Scope) =>
    gridOf(id)?.querySelector<HTMLElement>(
      ".library-unit__pulse",
    ) as HTMLElement | null;

  const keydown = (key: string) =>
    doc.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key,
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
      }),
    );
  const openSidebar = async () => {
    if (!header("personal")) {
      const trigger = await waitFor("library sidebar trigger", () =>
        root
          .querySelector<HTMLElement>(".default-sidebar-trigger")
          ?.closest("button"),
      );
      trigger.click();
    }
    await waitFor("library sections", () =>
      header("personal") && header("vault") ? true : null,
    );
  };
  const parse = (json: string | null) => {
    if (!json) {
      throw new Error("library file missing");
    }
    const lib = JSON.parse(json) as {
      type?: string;
      version?: number;
      libraryItems?: Array<{ id?: string; elements?: unknown[] }>;
    };
    if (
      lib.type !== "excalidrawlib" ||
      lib.version !== 2 ||
      !Array.isArray(lib.libraryItems) ||
      lib.libraryItems.some(
        (item) =>
          !item.id || !Array.isArray(item.elements) || !item.elements.length,
      )
    ) {
      throw new Error(`not standard excalidrawlib v2: ${json.slice(0, 200)}`);
    }
    return lib as typeof lib & {
      libraryItems: NonNullable<typeof lib.libraryItems>;
    };
  };
  const addFromSelection = async (id: Scope) => {
    // Select everything on the open drawing, as a user would, then use the tile.
    keydown("a");
    const tile = await waitFor(`${id} add tile`, () => adder(id), 5000);
    const before = tiles(id);
    tile.click();
    await waitFor(
      `${id} tile count to grow`,
      () => (tiles(id) > before ? true : null),
      5000,
    );
    return tiles(id);
  };
  const noNetworkUi = () => {
    const text = root.textContent ?? "";
    const links = Array.from(root.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    return {
      browseLibraries: /browse libraries/i.test(text),
      publish: /publish library/i.test(text),
      remoteLinks: links.filter((href) => /^https?:/i.test(href ?? "")),
    };
  };

  const initial = await read("personal");
  const phase: "persist" | "restore" =
    initial.json === null ? "persist" : "restore";
  const phaseNote = { phase, personalPath: initial.path };

  if (phase === "persist") {
    await step("library-persist-run1-add-items-via-ui", async () => {
      await openSidebar();
      const emptyBefore = [tiles("personal"), tiles("vault")];
      if (emptyBefore.some((n) => n !== 0)) {
        throw new Error(`expected empty sections, got ${emptyBefore}`);
      }
      const personal = await addFromSelection("personal");
      const vault = await addFromSelection("vault");
      return { ...phaseNote, tiles: { personal, vault } };
    });
    await step("library-persist-run1-files-written", async () => {
      const t0 = now();
      const poll = async (scope: Scope) => {
        const until = now() + 8000;
        while (now() < until) {
          const result = await read(scope);
          if (result.json) {
            return result;
          }
          await sleep(100);
        }
        throw new Error(`${scope} library.excalidrawlib not written within 8s`);
      };
      const p = await poll("personal");
      const v = await poll("vault");
      const pl = parse(p.json);
      const vl = parse(v.json);
      if (pl.libraryItems.length !== 1 || vl.libraryItems.length !== 1) {
        throw new Error(
          `expected 1 item per file, got ${pl.libraryItems.length}/${vl.libraryItems.length}`,
        );
      }
      if (pl.libraryItems[0].id === vl.libraryItems[0].id) {
        throw new Error("personal and vault items share an id");
      }
      return {
        writeLatencyMs: Math.round(now() - t0),
        personal: {
          path: p.path,
          items: pl.libraryItems.length,
          revision: p.revision,
        },
        vault: {
          path: v.path,
          items: vl.libraryItems.length,
          revision: v.revision,
        },
      };
    });
  } else {
    let expected = { personal: 0, vault: 0 };
    await step("library-persist-run2-loaded-without-adding", async () => {
      const p = await read("personal");
      const v = await read("vault");
      expected = {
        personal: parse(p.json).libraryItems.length,
        vault: parse(v.json).libraryItems.length,
      };
      if (!expected.personal || !expected.vault) {
        throw new Error(
          `files present but empty: ${JSON.stringify(expected)} (vault file ${
            v.json ? "exists" : "missing"
          })`,
        );
      }
      const clickAt = now();
      await openSidebar();
      await waitFor(
        "persisted tiles rendered",
        () =>
          tiles("personal") === expected.personal &&
          tiles("vault") === expected.vault
            ? true
            : null,
        8000,
      );
      const loadedAt = now();
      return {
        ...phaseNote,
        expected,
        tiles: { personal: tiles("personal"), vault: tiles("vault") },
        sidebarToTilesMs: Math.round(loadedAt - clickAt),
        appStartToLibraryLoadedMs: Math.round(loadedAt),
        smokeStartToLibraryLoadedMs: Math.round(loadedAt - startedAt),
      };
    });
    await step("library-persist-run2-external-edit-live", async () => {
      const p = await read("personal");
      const original = p.json as string;
      const lib = parse(original);
      const clone = {
        ...lib.libraryItems[0],
        id: `smoke-external-${Math.floor(win.Date.now()).toString(36)}`,
      };
      const edited = JSON.stringify({
        ...lib,
        libraryItems: [...lib.libraryItems, clone],
      });
      const t0 = now();
      const w1 = await write("personal", edited, p.revision);
      await waitFor(
        "external item to appear",
        () => (tiles("personal") === expected.personal + 1 ? true : null),
        8000,
      );
      const pickedUpMs = Math.round(now() - t0);
      // Restore the original so the next launch sees the same counts.
      const current = await read("personal");
      if (current.revision !== w1.revision) {
        throw new Error(
          "personal file changed under the smoke (editor wrote back?)",
        );
      }
      await write("personal", original, current.revision);
      await waitFor(
        "external removal to apply",
        () => (tiles("personal") === expected.personal ? true : null),
        8000,
      );
      return { pickedUpMs, restoredMs: Math.round(now() - t0) };
    });
  }

  await step("library-persist-no-network-ui", async () => {
    await openSidebar();
    const found = noNetworkUi();
    if (found.browseLibraries || found.publish || found.remoteLinks.length) {
      throw new Error(`online library UI present: ${JSON.stringify(found)}`);
    }
    return { ...phaseNote, ...found };
  });
  // Leave the editor as the following steps expect it.
  if (header("personal")) {
    root
      .querySelector<HTMLElement>(".default-sidebar-trigger")
      ?.closest("button")
      ?.click();
  }
  // Let late CSP reports from the previews land while the caller still marks them known.
  await sleep(300);
}
