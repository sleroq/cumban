import type { BasesPropertyId } from "obsidian";
import { get, writable, type Writable } from "svelte/store";

import type { RenderedGroup } from "./render-pipeline";

export type KanbanViewModel = {
  selectedPathsStore: Writable<Set<string>>;
  groupsStore: Writable<RenderedGroup[]>;
  groupByPropertyStore: Writable<BasesPropertyId | null>;
  selectedPropertiesStore: Writable<BasesPropertyId[]>;
  columnScrollByKeyStore: Writable<Record<string, number>>;
  pinnedColumnsStore: Writable<Set<string>>;
  draggingCardSourcePathStore: Writable<string | null>;
  draggingColumnSourceKeyStore: Writable<string | null>;
  setSelectedPaths: (selectedPaths: Set<string>) => void;
  setBoardData: (params: {
    groups: RenderedGroup[];
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
  }) => void;
  setColumnScrollByKey: (scrollByKey: Record<string, number>) => void;
  setPinnedColumns: (columns: Set<string>) => void;
  getColumnScrollByKey: () => Record<string, number>;
  startCardDrag: (filePath: string) => void;
  endCardDrag: () => void;
  getDraggingCardSourcePath: () => string | null;
  startColumnDrag: (columnKey: string) => void;
  endColumnDrag: () => void;
  getDraggingColumnSourceKey: () => string | null;
};

export function createKanbanViewModel(): KanbanViewModel {
  const selectedPathsStore = writable(new Set<string>());
  const groupsStore = writable<RenderedGroup[]>([]);
  const groupByPropertyStore = writable<BasesPropertyId | null>(null);
  const selectedPropertiesStore = writable<BasesPropertyId[]>([]);
  const columnScrollByKeyStore = writable<Record<string, number>>({});
  const pinnedColumnsStore = writable(new Set<string>());
  const draggingCardSourcePathStore = writable<string | null>(null);
  const draggingColumnSourceKeyStore = writable<string | null>(null);

  return {
    selectedPathsStore,
    groupsStore,
    groupByPropertyStore,
    selectedPropertiesStore,
    columnScrollByKeyStore,
    pinnedColumnsStore,
    draggingCardSourcePathStore,
    draggingColumnSourceKeyStore,

    setSelectedPaths(selectedPaths: Set<string>): void {
      selectedPathsStore.set(new Set(selectedPaths));
    },

    setBoardData({ groups, groupByProperty, selectedProperties }): void {
      groupsStore.set(groups);
      groupByPropertyStore.set(groupByProperty);
      selectedPropertiesStore.set(selectedProperties);
    },

    setColumnScrollByKey(scrollByKey: Record<string, number>): void {
      columnScrollByKeyStore.set(scrollByKey);
    },

    setPinnedColumns(columns: Set<string>): void {
      pinnedColumnsStore.set(columns);
    },

    getColumnScrollByKey(): Record<string, number> {
      return get(columnScrollByKeyStore);
    },

    startCardDrag(filePath: string): void {
      draggingCardSourcePathStore.set(filePath);
    },

    endCardDrag(): void {
      draggingCardSourcePathStore.set(null);
    },

    getDraggingCardSourcePath(): string | null {
      return get(draggingCardSourcePathStore);
    },

    startColumnDrag(columnKey: string): void {
      draggingColumnSourceKeyStore.set(columnKey);
    },

    endColumnDrag(): void {
      draggingColumnSourceKeyStore.set(null);
    },

    getDraggingColumnSourceKey(): string | null {
      return get(draggingColumnSourceKeyStore);
    },
  };
}
