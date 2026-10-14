/**
 * Registry entries (metadata only) for commands whose handlers the open
 * editor binds through registerCommandHandlers (paper, library, ...).
 * Spread into COMMANDS (commands.ts). No default keys: rebindable on the
 * Hotkeys page.
 */
import { PAPER_STYLES } from "../components/paper/paperStyles";

import type { CommandDefinition } from "./types";

export const paperCommandId = (style: string) => `paper.${style}`;

const PAPER_COMMANDS: CommandDefinition[] = [
  ...PAPER_STYLES.map(
    (style): CommandDefinition => ({
      id: paperCommandId(style.id),
      title: `Paper: ${style.label}`,
      category: "Paper",
      keys: { default: [] },
      when: ["drawingOpen", "writable"],
    }),
  ),
  {
    id: "paper.settings",
    title: "Paper settings…",
    category: "Paper",
    keys: { default: [] },
    when: ["drawingOpen", "writable"],
  },
];

export const EDITOR_COMMANDS: readonly CommandDefinition[] = [
  ...PAPER_COMMANDS,
  {
    id: "library.toggle",
    title: "Library: Open/close",
    category: "Library",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
];
