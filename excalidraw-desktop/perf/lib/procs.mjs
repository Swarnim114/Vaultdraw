// Process discovery + RSS / CPU-time sampling via ps. macOS only.
import { execFile, spawn } from "node:child_process";

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve({ err, stdout: String(stdout ?? "") }));
  });

/**
 * macOS `ps -o time=` prints [[dd-]hh:]mm:ss.cc, i.e. CENTISECOND resolution (verified on Darwin 25), which is plenty
 * for a 10 s idle window (1 cs = 0.1% of one core over 10 s). Returns seconds, NaN when unparseable.
 */
export function parsePsTime(s) {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(s ?? "");
  if (!m) return NaN;
  const [, d, h, mi, sec] = m;
  return (Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(mi) * 60 + Number(sec);
}

/** Parse `ps -o pid=,rss=,time=` output into Map<pid, {rssKB, cpuSec}>. */
export function parsePsSample(text) {
  const out = new Map();
  for (const line of String(text).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    if (!m) continue;
    out.set(Number(m[1]), { rssKB: Number(m[2]), cpuSec: parsePsTime(m[3]) });
  }
  return out;
}

/** Parse `ps -axo pid=,ppid=,comm=` into [{pid, ppid, comm}] (comm may contain spaces). */
export function parsePsList(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  return out;
}

export async function listProcesses() {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid=,comm="]);
  return parsePsList(stdout);
}

export const isWebKitHelper = (p) => /com\.apple\.WebKit\.(WebContent|GPU|Networking)\.xpc\/Contents\/MacOS\/com\.apple\.WebKit\.(WebContent|GPU|Networking)$/.test(p.comm);

export async function snapshotWebKitPids() {
  return new Set((await listProcesses()).filter(isWebKitHelper).map((p) => p.pid));
}

/**
 * WebKit helpers of OUR app. They are XPC services launched by launchd (not children of the app) and macOS exposes no
 * responsible-pid without root, so ownership can't be verified. Heuristic: WebKit helper pids that did not exist in the
 * pre-spawn snapshot and are alive now. Caveat: another WebKit app (Safari, another perf/smoke run) launching in the
 * same window would be picked up too; run perf on a quiet machine and not concurrently with other WebKit apps.
 */
export async function discoverWebKitHelpers(beforeSet) {
  return (await listProcesses()).filter((p) => isWebKitHelper(p) && !beforeSet.has(p.pid)).map((p) => p.pid);
}

/** Sample rss (KB) and cumulative cpu seconds. Dead pids are simply absent from the result. */
export async function sampleProcs(pids) {
  if (!pids.length) return new Map();
  const { stdout } = await run("ps", ["-o", "pid=,rss=,time=", "-p", pids.join(",")]);
  return parsePsSample(stdout);
}

export async function applyBackgroundPolicy(pid) {
  const { err } = await run("taskpolicy", ["-b", "-p", String(pid)]);
  return !err;
}

// ---- child tracking so nothing is left behind on exit / SIGINT ----
const tracked = new Set();
let hooked = false;
function killAll() {
  for (const c of tracked) {
    try { c.kill("SIGKILL"); } catch { /* gone */ }
  }
}
export function trackChild(child) {
  tracked.add(child);
  child.once("close", () => tracked.delete(child));
  if (!hooked) {
    hooked = true;
    process.on("exit", killAll);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, () => { killAll(); process.exit(130); });
    }
  }
  return child;
}

/**
 * Simulated memory pressure (`memory_pressure -S`, never the allocating mode). It needs root to flip the kernel knob
 * (sysctl kern.memorypressure_manual_trigger: Operation not permitted). Resolves a handle { stop(), note } where note
 * reports whether it could apply.
 */
export function startMemoryPressure({ seconds = 60, log = () => {} } = {}) {
  const child = trackChild(spawn("memory_pressure", ["-S", "-l", "warn", "-s", String(seconds)], { stdio: ["ignore", "pipe", "pipe"] }));
  let text = "";
  const onData = (d) => { if (text.length < 8192) text += d; };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", () => {});
  const handle = {
    child,
    get applied() { return !/not permitted|failed/i.test(text); },
    stop() { try { child.kill("SIGKILL"); } catch { /* gone */ } },
    note() {
      return handle.applied
        ? "memory_pressure -S active"
        : "memory_pressure -S could not apply (needs root: kern.memorypressure_manual_trigger not permitted); continued without it";
    },
  };
  return handle;
}
