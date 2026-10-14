/**
 * Registry entries (metadata only) for commands whose handlers the open
 * editor binds through registerCommandHandlers (paper, library, ...).
 * Spread into COMMANDS (commands.ts).
 */
import type { CommandDefinition } from "./types";

export const EDITOR_COMMANDS: readonly CommandDefinition[] = [];
