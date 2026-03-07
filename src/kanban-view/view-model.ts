import type { BasesPropertyId } from "obsidian";
import { get, writable, type Writable } from "svelte/store";

import type { RenderedGroup } from "./render-pipeline";
import { getColumnKey } from "./utils";

export type KanbanViewModel = {
  selectedPathsStore: Writable<Set<string>>;
  activeTagFiltersStore: Writable<string[]>;
  groupsStore: Writable<RenderedGroup[]>;
  groupByPropertyStore: Writable<BasesPropertyId | null>;
  selectedPropertiesStore: Writable<BasesPropertyId[]>;
  cardCoverEnabledStore: Writable<boolean>;
  cardCoverSourceStore: Writable<string>;
  columnScrollByKeyStore: Writable<Record<string, number>>;
  pinnedColumnsStore: Writable<Set<string>>;
  draggingCardSourcePathStore: Writable<string | null>;
  draggingColumnSourceKeyStore: Writable<string | null>;
  animationsReadyStore: Writable<boolean>;
  setSelectedPaths: (selectedPaths: Set<string>) => void;
  setActiveTagFilters: (activeTagFilters: string[]) => void;
  setBoardData: (params: {
    groups: RenderedGroup[];
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    cardCoverEnabled: boolean;
    cardCoverSource: string;
  }) => void;
  setColumnScrollByKey: (scrollByKey: Record<string, number>) => void;
  setPinnedColumns: (columns: Set<string>) => void;
  getColumnScrollByKey: () => Record<string, number>;
  setAnimationsReady: (ready: boolean) => void;
  startCardDrag: (filePath: string) => void;
  endCardDrag: () => void;
  startColumnDrag: (columnKey: string) => void;
  endColumnDrag: () => void;
};

export function createKanbanViewModel(): KanbanViewModel {
  const selectedPathsStore = writable(new Set<string>());
  const activeTagFiltersStore = writable<string[]>([]);
  const groupsStore = writable<RenderedGroup[]>([]);
  const groupByPropertyStore = writable<BasesPropertyId | null>(null);
  const selectedPropertiesStore = writable<BasesPropertyId[]>([]);
  const cardCoverEnabledStore = writable<boolean>(true);
  const cardCoverSourceStore = writable<string>("cover");
  const columnScrollByKeyStore = writable<Record<string, number>>({});
  const pinnedColumnsStore = writable(new Set<string>());
  const draggingCardSourcePathStore = writable<string | null>(null);
  const draggingColumnSourceKeyStore = writable<string | null>(null);
  const animationsReadyStore = writable(false);

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
    activeTagFiltersStore,
    groupsStore,
    groupByPropertyStore,
    selectedPropertiesStore,
    cardCoverEnabledStore,
    cardCoverSourceStore,
    columnScrollByKeyStore,
    pinnedColumnsStore,
    draggingCardSourcePathStore,
    draggingColumnSourceKeyStore,
    animationsReadyStore,

    setSelectedPaths(selectedPaths: Set<string>): void {
      selectedPathsStore.set(new Set(selectedPaths));
    },

    setActiveTagFilters(activeTagFilters: string[]): void {
      const currentActiveTagFilters = get(activeTagFiltersStore);
      if (!areStringArraysEqual(currentActiveTagFilters, activeTagFilters)) {
        activeTagFiltersStore.set([...activeTagFilters]);
      }
    },

    setBoardData({
      groups,
      groupByProperty,
      selectedProperties,
      cardCoverEnabled,
      cardCoverSource,
    }): void {
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

      if (get(cardCoverEnabledStore) !== cardCoverEnabled) {
        cardCoverEnabledStore.set(cardCoverEnabled);
      }

      if (get(cardCoverSourceStore) !== cardCoverSource) {
        cardCoverSourceStore.set(cardCoverSource);
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

    setAnimationsReady(ready: boolean): void {
      animationsReadyStore.set(ready);
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
