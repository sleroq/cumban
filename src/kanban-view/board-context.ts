import type { BasesPropertyId } from "obsidian";

import type { KanbanCallbacks } from "./actions";
import type { KanbanDragState } from "./drag-state";

export type KanbanBoardContext = {
  groupByProperty: BasesPropertyId | null;
  selectedProperties: BasesPropertyId[];
  dragState: KanbanDragState;
  callbacks: KanbanCallbacks;
  setActivePropertyEditor: (
    filePath: string,
    close: () => Promise<void>,
    isTargetInsideEditor: (target: Node) => boolean,
  ) => void;
  clearActivePropertyEditor: (filePath: string) => void;
};

export const KANBAN_BOARD_CONTEXT_KEY = Symbol("kanban-board-context");
