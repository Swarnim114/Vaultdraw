import { describe, expect, it } from "vitest";

import { filter, prepare } from "./fuzzy";

const WORDS = [
  "Introduction",
  "Graphs",
  "Dynamic",
  "Programming",
  "Architecture",
  "Notes",
  "Design",
  "System",
  "Database",
  "Network",
  "Sorting",
  "Trees",
  "Linked",
  "List",
  "Array",
  "Queue",
  "Stack",
  "Meeting",
  "Roadmap",
  "Sprint",
  "Review",
  "Diagram",
  "Flow",
  "Sketch",
  "Wireframe",
  "Mockup",
  "Brainstorm",
  "Ideas",
  "Plan",
  "Overview",
  "Summary",
  "Chapter",
  "Lecture",
  "Homework",
  "Project",
  "Café",
  "Résumé",
  "Backend",
  "Frontend",
  "Kubernetes",
  "Pipeline",
  "Cache",
];
const FOLDERS = [
  "DSA",
  "Work",
  "School",
  "Personal",
  "Archive",
  "Ideas",
  "Projects",
  "Design Notes",
  "Meetings",
  "2024",
  "2025",
  "Reading List",
  "Diagrams",
];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generatePaths(count: number): string[] {
  const r = rng(42);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const depth = Math.floor(r() * 4);
    const parts: string[] = [];
    for (let d = 0; d < depth; d++) {
      parts.push(pick(FOLDERS));
    }
    const words = 1 + Math.floor(r() * 4);
    const name: string[] = [];
    if (r() < 0.4) {
      name.push(String(Math.floor(r() * 99)).padStart(2, "0"));
    }
    for (let w = 0; w < words; w++) {
      name.push(pick(WORDS));
    }
    parts.push(`${name.join(" ")} ${i}.excalidraw`);
    paths.push(parts.join("/"));
  }
  return paths;
}

const typing = (word: string) =>
  Array.from({ length: word.length }, (_, i) => word.slice(0, i + 1));

const QUERIES = [
  ...typing("architecture"),
  ...typing("dp intro"),
  ...typing("graphs"),
  ...typing("zzqxj"),
  ...typing("work des notes"),
  "a",
  "e",
];

describe("fuzzy performance (5,000 drawings)", () => {
  it("filter(limit 50) stays well under the per-keystroke budget", () => {
    const paths = generatePaths(5000);
    const t0 = performance.now();
    const prepared = paths.map((p) => prepare(p));
    const prepareMs = performance.now() - t0;

    const get = (p: typeof prepared[number]) => p;
    // warm up the JIT like a real session would
    for (let i = 0; i < 3; i++) {
      for (const q of QUERIES) {
        filter(prepared, q, get, 50);
      }
    }
    const times: number[] = [];
    for (let run = 0; run < 10; run++) {
      for (const q of QUERIES) {
        const s = performance.now();
        filter(prepared, q, get, 50);
        times.push(performance.now() - s);
      }
    }
    times.sort((a, b) => a - b);
    const at = (p: number) =>
      times[Math.min(times.length - 1, Math.floor(p * times.length))];
    // eslint-disable-next-line no-console
    console.info(
      `fuzzy 5000 paths: prepare ${prepareMs.toFixed(1)} ms; filter p50 ${at(
        0.5,
      ).toFixed(2)} ms, p95 ${at(0.95).toFixed(2)} ms, max ${times[
        times.length - 1
      ].toFixed(2)} ms (${times.length} samples)`,
    );
    expect(at(0.95)).toBeLessThan(8);
  });
});
