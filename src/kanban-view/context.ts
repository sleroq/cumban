import type { App } from "obsidian";
import type { Readable } from "svelte/store";

import type { BasesKanbanSettings } from "../settings";

/**
 * Kanban context for settings and shared state.
 * Passed via Svelte context to avoid prop drilling for these values.
 * Actions and drag state are passed as props rather than context.
 */
export type KanbanContext = {
  app: App;
  settingsStore: Readable<BasesKanbanSettings>;
  selectedPathsStore: Readable<Set<string>>;
  pinnedColumnsStore: Readable<Set<string>>;
};

/** Context key - using Symbol for uniqueness */
export const KANBAN_CONTEXT_KEY = Symbol("kanban-context");
