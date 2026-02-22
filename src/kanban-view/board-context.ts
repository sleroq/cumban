import type { BasesPropertyId } from "obsidian";

import type { KanbanCallbacks } from "./actions";
import type { KanbanDragState } from "./drag-state";

export type KanbanBoardContext = {
  groupByProperty: BasesPropertyId | null;
  selectedProperties: BasesPropertyId[];
  dragState: KanbanDragState;
  callbacks: KanbanCallbacks;
};

export const KANBAN_BOARD_CONTEXT_KEY = Symbol("kanban-board-context");
