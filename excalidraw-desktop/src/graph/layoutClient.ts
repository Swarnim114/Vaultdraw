/**
 * Main-thread side of the force layout. Spawns the module worker lazily (Vite emits it as its own
 * chunk); without `Worker` (jsdom) it runs the same LayoutHost in-thread.
 *
 * `onPositions` receives the latest Float32Array(2n). It stays valid until the next
 * `onPositions` call (the previous buffer is then handed back to the worker), so read or
 * copy it synchronously or in the next frame, never keep it longer.
 */
import { LayoutHost, type FromLayout, type ToLayout } from "./layoutHost";

import type { ForceSettings, LayoutParams } from "./barnesHut";

export interface LayoutStart {
  nodeCount: number;
  /** `(src, dst)` pairs; transferred (do not reuse). */
  edges: Uint32Array;
  /** `2 * n`, e.g. from `seedPositions`; transferred (do not reuse). */
  positions: Float32Array;
  settings?: Partial<ForceSettings>;
  params?: Partial<LayoutParams>;
  /** 1 = hidden by a filter. */
  mask?: Uint8Array | null;
  /** Start alpha: 1 cold (default), ~0.02 warm (ALPHA_WARM). */
  alpha?: number;
  /** Relax only the 2-hop neighbourhood of these nodes (warm start with new nodes). */
  focus?: Uint32Array | null;
}

export interface LayoutCallbacks {
  onPositions(
    positions: Float32Array,
    info: { tick: number; alpha: number },
  ): void;
  onSettled?(tick: number): void;
}

interface Transport {
  send(msg: ToLayout, transfer?: ArrayBuffer[]): void;
  close(): void;
}

function workerTransport(onMessage: (m: FromLayout) => void): Transport {
  const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent<FromLayout>) => onMessage(e.data);
  return {
    send: (msg, transfer = []) => worker.postMessage(msg, transfer),
    close: () => worker.terminate(),
  };
}

function inThreadTransport(
  onMessage: (m: FromLayout) => void,
  hostRef: { host: LayoutHost | null },
): Transport {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const host = new LayoutHost(
    (msg) => onMessage(msg),
    () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => host.run(), 0);
    },
  );
  hostRef.host = host;
  return {
    send: (msg) => host.handle(msg),
    close: () => {
      host.handle({ type: "stop" });
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

export class LayoutClient {
  private transport: Transport | null = null;
  private readonly hostRef: { host: LayoutHost | null } = { host: null };
  private last: Float32Array | null = null;

  constructor(
    private readonly cb: LayoutCallbacks,
    private readonly inThread = typeof Worker === "undefined",
  ) {}

  start(init: LayoutStart): void {
    const { nodeCount, ...rest } = init;
    this.ensure().send({ type: "init", n: nodeCount, ...rest }, [
      init.edges.buffer,
      init.positions.buffer,
      ...(init.mask ? [init.mask.buffer] : []),
      ...(init.focus ? [init.focus.buffer] : []),
    ] as ArrayBuffer[]);
  }

  setSettings(settings: Partial<ForceSettings>): void {
    this.transport?.send({ type: "settings", settings });
  }

  drag(node: number, x: number, y: number): void {
    this.transport?.send({ type: "drag", node, x, y });
  }

  release(): void {
    this.transport?.send({ type: "release" });
  }

  reheat(alpha?: number): void {
    this.transport?.send({ type: "reheat", alpha });
  }

  /** Hide nodes (1 = hidden); `null` shows everything. Transferred. */
  setMask(mask: Uint8Array | null): void {
    this.transport?.send(
      { type: "mask", mask },
      mask ? [mask.buffer as ArrayBuffer] : [],
    );
  }

  /** Stop and release the worker (or the in-thread layout). Safe to call twice. */
  terminate(): void {
    this.transport?.close();
    this.transport = null;
    this.hostRef.host = null;
    this.last = null;
  }

  /**
   * In-thread only (tests): tick synchronously until settled or `maxTicks`.
   * Returns whether the layout settled.
   */
  runSync(maxTicks = 100000): boolean {
    const host = this.hostRef.host;
    if (!host) {
      throw new Error("runSync needs the in-thread transport");
    }
    for (let i = 0; i < maxTicks && host.active; i++) {
      host.run();
    }
    return !host.active;
  }

  private ensure(): Transport {
    if (!this.transport) {
      const onMessage = (m: FromLayout) => this.receive(m);
      this.transport = this.inThread
        ? inThreadTransport(onMessage, this.hostRef)
        : workerTransport(onMessage);
    }
    return this.transport;
  }

  private receive(m: FromLayout): void {
    if (m.type === "positions") {
      const prev = this.last;
      this.last = m.positions;
      if (prev) {
        this.transport?.send(
          { type: "recycle", buffer: prev.buffer as ArrayBuffer },
          [prev.buffer as ArrayBuffer],
        );
      }
      this.cb.onPositions(m.positions, { tick: m.tick, alpha: m.alpha });
    } else {
      this.cb.onSettled?.(m.tick);
    }
  }
}
