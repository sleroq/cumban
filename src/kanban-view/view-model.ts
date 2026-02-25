import type { BasesPropertyId } from "obsidian";
import { get, writable, type Writable } from "svelte/store";

import type { RenderedGroup } from "./render-pipeline";
import { getColumnKey } from "./utils";

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
  startColumnDrag: (columnKey: string) => void;
  endColumnDrag: () => void;
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

  function areStringArraysEqual(a: string[], b: string[]): boolean {
    if (a === b) {
      return true;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  function areRenderedGroupsEqual(
    current: RenderedGroup[],
    next: RenderedGroup[],
  ): boolean {
    if (current === next) {
      return true;
    }
    if (current.length !== next.length) {
      return false;
    }

    for (let i = 0; i < current.length; i++) {
      const currentGroup = current[i];
      const nextGroup = next[i];
      if (currentGroup === undefined || nextGroup === undefined) {
        return false;
      }

      if (
        getColumnKey(currentGroup.group.key) !==
        getColumnKey(nextGroup.group.key)
      ) {
        return false;
      }

      if (currentGroup.entries.length !== nextGroup.entries.length) {
        return false;
      }

      for (
        let entryIndex = 0;
        entryIndex < currentGroup.entries.length;
        entryIndex++
      ) {
        const currentEntry = currentGroup.entries[entryIndex];
        const nextEntry = nextGroup.entries[entryIndex];
        if (
          currentEntry === undefined ||
          nextEntry === undefined ||
          currentEntry.file.path !== nextEntry.file.path
        ) {
          return false;
        }
      }
    }

    return true;
  }

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
      const currentGroups = get(groupsStore);
      if (!areRenderedGroupsEqual(currentGroups, groups)) {
        groupsStore.set(groups);
      }

      if (get(groupByPropertyStore) !== groupByProperty) {
        groupByPropertyStore.set(groupByProperty);
      }

      const currentSelectedProperties = get(selectedPropertiesStore);
      if (
        !areStringArraysEqual(currentSelectedProperties, selectedProperties)
      ) {
        selectedPropertiesStore.set(selectedProperties);
      }
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

    startColumnDrag(columnKey: string): void {
      draggingColumnSourceKeyStore.set(columnKey);
    },

    endColumnDrag(): void {
      draggingColumnSourceKeyStore.set(null);
    },
  };
}
