import type { BasesEntry, BasesEntryGroup } from "obsidian";

import { getColumnKey } from "./utils";

export type RenderedGroup = {
  group: BasesEntryGroup;
  entries: BasesEntry[];
};

/**
 * Merge groups that share the same column key.
 * Groups with the same normalized key are combined into one.
 */
export function mergeGroupsByColumnKey(
  groups: BasesEntryGroup[],
): BasesEntryGroup[] {
  const mergedByColumnKey = new Map<string, BasesEntryGroup>();

  for (const group of groups) {
    const columnKey = getColumnKey(group.key);
    const existing = mergedByColumnKey.get(columnKey);
    if (existing === undefined) {
      mergedByColumnKey.set(columnKey, {
        key: group.key,
        hasKey: group.hasKey,
        entries: [...group.entries],
      });
      continue;
    }

    existing.hasKey = existing.hasKey || group.hasKey;
    existing.entries.push(...group.entries);
  }

  return [...mergedByColumnKey.values()];
}

/**
 * Sort groups according to the configured column order.
 * Groups not in the order config are placed at the end.
 */
export function sortGroupsByColumnOrder(
  groups: BasesEntryGroup[],
  columnOrder: string[],
): BasesEntryGroup[] {
  if (columnOrder.length === 0) {
    return groups;
  }

  const orderMap = new Map(
    columnOrder.map((columnKey, index) => [columnKey, index]),
  );
  return [...groups].sort((groupA, groupB) => {
    const indexA =
      orderMap.get(getColumnKey(groupA.key)) ?? Number.POSITIVE_INFINITY;
    const indexB =
      orderMap.get(getColumnKey(groupB.key)) ?? Number.POSITIVE_INFINITY;
    if (
      indexA === Number.POSITIVE_INFINITY &&
      indexB === Number.POSITIVE_INFINITY
    ) {
      return 0;
    }

    return indexA - indexB;
  });
}

/**
 * Apply local card order to entries within a column.
 * Entries are reordered according to the saved order, with new entries prepended.
 */
export function applyLocalCardOrder(
  columnKey: string,
  entries: BasesEntry[],
  localOrderByColumn: Map<string, string[]>,
): BasesEntry[] {
  const orderedPaths = localOrderByColumn.get(columnKey);
  if (orderedPaths === undefined || orderedPaths.length === 0) {
    return entries;
  }

  const entryByPath = new Map(entries.map((entry) => [entry.file.path, entry]));
  const nextEntries: BasesEntry[] = [];
  const usedPaths = new Set<string>();

  for (const path of orderedPaths) {
    const entry = entryByPath.get(path);
    if (entry === undefined) {
      continue;
    }

    nextEntries.push(entry);
    usedPaths.add(path);
  }

  const newEntries: BasesEntry[] = [];
  for (const entry of entries) {
    if (usedPaths.has(entry.file.path)) {
      continue;
    }

    newEntries.push(entry);
  }

  nextEntries.unshift(...newEntries);

  return nextEntries;
}

/**
 * Build rendered groups by applying local card order to each column.
 */
export function buildRenderedGroups(
  orderedGroups: BasesEntryGroup[],
  localCardOrderByColumn: Map<string, string[]>,
): RenderedGroup[] {
  return orderedGroups.map((group) => ({
    group,
    entries: applyLocalCardOrder(
      getColumnKey(group.key),
      group.entries,
      localCardOrderByColumn,
    ),
  }));
}
