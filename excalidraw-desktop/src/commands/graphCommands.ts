/**
 * Graph view commands (P3). Handlers are bound by GraphHost; a command
 * without one is simply not offered. The key set is Obsidian's Mod+Alt family
 * (D18); the toggles have no default key.
 */
import type { CommandDefinition } from "./types";

export const GRAPH_COMMAND_IDS = {
  open: "graph.open",
  openLocal: "graph.openLocal",
  toggleOrphans: "graph.toggleOrphans",
  toggleTags: "graph.toggleTags",
  toggleUnresolved: "graph.toggleUnresolved",
  fit: "graph.fit",
} as const;

const VAULT = ["vaultOpen", "!modalOpen"] as const;

const command = (
  id: string,
  title: string,
  keys: string[],
  when: CommandDefinition["when"],
): CommandDefinition => ({
  id,
  title: `Graph: ${title}`,
  category: "Graph",
  keys: { default: keys },
  when,
});

const I = GRAPH_COMMAND_IDS;

export const GRAPH_COMMANDS: CommandDefinition[] = [
  command(I.open, "Open graph view", ["Mod+Alt+G"], [...VAULT]),
  command(I.openLocal, "Open local graph", ["Mod+Alt+L"], [
    "drawingOpen",
    "!modalOpen",
  ]),
  command(I.toggleOrphans, "Toggle orphans", [], [...VAULT]),
  command(I.toggleTags, "Toggle tags", [], [...VAULT]),
  command(I.toggleUnresolved, "Toggle unresolved links", [], [...VAULT]),
  command(I.fit, "Fit graph to view", [], [...VAULT]),
];
