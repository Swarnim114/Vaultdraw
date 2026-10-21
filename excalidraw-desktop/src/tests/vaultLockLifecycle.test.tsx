/**
 * Vault lock lifecycle (toimprove #39): the app must never hold two native
 * handles for one vault, or the second open goes read-only. A fake native
 * side mirrors open_vault's flock rule: a path whose lock is held by a live
 * handle opens read-only.
 */
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VaultApp } from "../VaultApp";
import {
  DesktopVaultRepository,
  type InvokeFn,
  type ListenFn,
} from "../vault/DesktopVaultRepository";

import type { VaultInfo } from "../vault/types";

class FakeNative {
  live = new Map<string, VaultInfo>();
  locks = new Map<string, string>();
  opens: string[] = [];
  picks: string[] = [];
  recent: string | null = null;
  /** Paths whose lock another Vaultdraw process holds. */
  otherProcess = new Set<string>();
  private next = 0;

  open(path: string): VaultInfo {
    const handle = `h${++this.next}`;
    const byOther = this.otherProcess.has(path);
    const readOnly = byOther || this.locks.has(path);
    if (!readOnly) {
      this.locks.set(path, handle);
    }
    const info: VaultInfo = {
      handle,
      path,
      name: path.split("/").pop()!,
      readOnly,
      readOnlyReason: byOther ? "lockedByOtherProcess" : null,
      lockHolderPid: byOther ? 4242 : null,
    };
    this.live.set(handle, info);
    this.opens.push(path);
    return info;
  }

  release(handle: string) {
    const info = this.live.get(handle);
    this.live.delete(handle);
    if (info && this.locks.get(info.path) === handle) {
      this.locks.delete(info.path);
    }
  }

  invoke: InvokeFn = async <T,>(cmd: string, raw?: unknown) => {
    const args = raw as Record<string, unknown> | undefined;
    await Promise.resolve();
    switch (cmd) {
      case "reopen_vault":
        return (this.recent ? this.open(this.recent) : null) as T;
      case "choose_vault": {
        const path = this.picks.shift();
        if (!path) {
          return null as T;
        }
        const info = this.open(path);
        this.recent = path;
        return info as T;
      }
      case "retry_vault":
        return this.open(this.live.get(String(args?.handle))!.path) as T;
      case "release_vault":
        this.release(String(args?.handle));
        return undefined as T;
      case "list_directory":
      case "list_recovery":
        return [] as T;
      default:
        return null as T;
    }
  };

  listen: ListenFn = async () => () => {};
}

const setup = (strict: boolean, prepare?: (native: FakeNative) => void) => {
  const native = new FakeNative();
  native.recent = "/v/A";
  prepare?.(native);
  const repository = new DesktopVaultRepository({
    invoke: native.invoke,
    listen: native.listen,
  });
  const app = <VaultApp repository={repository} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return native;
};

const switchTo = async (native: FakeNative, path: string) => {
  native.picks.push(path);
  fireEvent.click(
    await screen.findByLabelText("Close current vault and open another"),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Close current vault and open another"),
    ).toHaveTextContent(path.split("/").pop()!),
  );
};

describe("vault lock lifecycle", () => {
  it.each([false, true])(
    "startup opens the last vault once and writable (StrictMode %s)",
    async (strict) => {
      const native = setup(strict);
      await screen.findByLabelText("Close current vault and open another");
      await waitFor(() => expect(native.live.size).toBe(1));
      expect([...native.live.values()][0].readOnly).toBe(false);
      expect(screen.queryByText(/read-only/i)).toBeNull();
    },
  );

  it("switching A → B → A keeps one handle and A comes back writable", async () => {
    const native = setup(false);
    await screen.findByLabelText("Close current vault and open another");
    await switchTo(native, "/v/B");
    await switchTo(native, "/v/A");
    await waitFor(() => expect(native.live.size).toBe(1));
    expect([...native.live.values()][0]).toMatchObject({
      path: "/v/A",
      readOnly: false,
    });
  });

  it("picking the vault that is already open keeps it writable", async () => {
    const native = setup(false);
    await screen.findByLabelText("Close current vault and open another");
    native.picks.push("/v/A");
    fireEvent.click(
      screen.getByLabelText("Close current vault and open another"),
    );
    await waitFor(() => expect(native.opens.length).toBe(2));
    await waitFor(() => expect(native.live.size).toBe(1));
    expect([...native.live.values()][0].readOnly).toBe(false);
  });

  it("the Read-Only badge says another Vaultdraw holds the vault and Try again makes it writable", async () => {
    const native = setup(false, (n) => n.otherProcess.add("/v/A"));
    fireEvent.click(await screen.findByRole("button", { name: /Read-Only/ }));
    const panel = screen.getByRole("dialog", {
      name: "Why this vault is read-only",
    });
    expect(panel).toHaveTextContent("Another Vaultdraw (process 4242)");

    // Still held: the retry handle is released again and the badge stays.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(native.opens.length).toBe(2));
    await waitFor(() => expect(native.live.size).toBe(1));
    expect(screen.getByRole("button", { name: /Read-Only/ })).toBeTruthy();

    // The other process quits: Try again swaps in a writable handle.
    native.otherProcess.clear();
    fireEvent.click(screen.getByRole("button", { name: /Read-Only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Read-Only/ })).toBeNull(),
    );
    expect(native.live.size).toBe(1);
    expect([...native.live.values()][0].readOnly).toBe(false);
  });
});
