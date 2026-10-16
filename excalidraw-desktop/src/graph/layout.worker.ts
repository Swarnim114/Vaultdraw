/// <reference lib="webworker" />
/** Layout worker: a thin shell around LayoutHost (see layoutHost.ts for the protocol). */
import { LayoutHost, type ToLayout } from "./layoutHost";

const channel = new MessageChannel();
const host = new LayoutHost(
  (msg, transfer) => self.postMessage(msg, transfer),
  () => channel.port2.postMessage(0),
);
// Ticks run on their own channel so incoming drag/settings messages interleave between slices.
channel.port1.onmessage = () => host.run();
self.onmessage = (e: MessageEvent<ToLayout>) => host.handle(e.data);
