import type { BasesEntry, BasesPropertyId } from "obsidian";

export type PropertyEditorMode = "single" | "multi";

export type PropertyType = "date" | "text" | "multitext" | "tags" | "select" | "checkbox" | "number" | "datetime" | "time" | "unknown";

export type KanbanCardCallbacks = {
  select: (filePath: string, extendSelection: boolean) => void;
  dragStart: (filePath: string, cardIndex: number) => void;
  dragEnd: () => void;
  drop: (
    sourcePath: string | null,
    filePath: string | null,
    groupKey: unknown,
    placement: "before" | "after",
  ) => void;
  contextMenu: (evt: MouseEvent, entry: BasesEntry) => void;
  linkClick: (evt: MouseEvent, target: string) => void;
  getPropertyEditorMode: (propertyId: BasesPropertyId) => PropertyEditorMode | null;
  getPropertyType: (propertyId: BasesPropertyId) => PropertyType;
  getPropertySuggestions: (propertyId: BasesPropertyId) => string[];
  updatePropertyValues: (
    filePath: string,
    propertyId: BasesPropertyId,
    mode: PropertyEditorMode,
    values: string[],
  ) => Promise<void>;
};

export type KanbanColumnCallbacks = {
  createCard: (groupByProperty: BasesPropertyId | null, groupKey: unknown) => void;
  startDrag: (columnKey: string) => void;
  endDrag: () => void;
  drop: (
    sourceKey: string | null,
    targetKey: string,
    placement: "before" | "after",
  ) => void;
  togglePin: (columnKey: string) => void;
  cardsScroll: (columnKey: string, scrollTop: number) => void;
};

export type KanbanBoardCallbacks = {
  scroll: (scrollLeft: number, scrollTop: number) => void;
  keyDown: (evt: KeyboardEvent) => void;
  click: () => void;
};

export type KanbanCallbacks = {
  card: KanbanCardCallbacks;
  column: KanbanColumnCallbacks;
  board: KanbanBoardCallbacks;
};
