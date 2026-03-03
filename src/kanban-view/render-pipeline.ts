import type { BasesEntry, BasesEntryGroup, BasesPropertyId } from "obsidian";

import {
  getColumnKey,
  getEntryTagValues,
  normalizeTagFilterValue,
} from "./utils";

export type RenderedGroup = {
  group: BasesEntryGroup;
  entries: BasesEntry[];
};

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
        hasKey: group.hasKey.bind(group),
        entries: [...group.entries],
      });
      continue;
    }

    existing.entries.push(...group.entries);
  }

  return [...mergedByColumnKey.values()];
}

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

type TagFilterParams = {
  activeTagFilters: string[];
  selectedProperties: BasesPropertyId[];
  groupByProperty: BasesPropertyId | null;
  tagPropertySuffix: string;
};

function entryMatchesTagFilter(
  entry: BasesEntry,
  normalizedActiveTagFilters: string[],
  tagPropertyIds: BasesPropertyId[],
): boolean {
  const tags = getEntryTagValues(entry, tagPropertyIds);
  const normalizedEntryTags = new Set<string>(
    tags.map((tag) => normalizeTagFilterValue(tag)),
  );

  return normalizedActiveTagFilters.every((tagFilter) => {
    return normalizedEntryTags.has(tagFilter);
  });
}

export function filterRenderedGroupsByTag(
  groups: RenderedGroup[],
  {
    activeTagFilters,
    selectedProperties,
    groupByProperty,
    tagPropertySuffix,
  }: TagFilterParams,
): RenderedGroup[] {
  if (activeTagFilters.length === 0) {
    return groups;
  }

  const normalizedActiveTagFilters = activeTagFilters
    .map((tagFilter) => normalizeTagFilterValue(tagFilter))
    .filter((tagFilter) => tagFilter.length > 0);

  if (normalizedActiveTagFilters.length === 0) {
    return groups;
  }

  const tagPropertyIds = selectedProperties.filter((propertyId) => {
    if (propertyId === groupByProperty) {
      return false;
    }

    return propertyId.endsWith(tagPropertySuffix);
  });

  return groups.map((group) => ({
    group: group.group,
    entries: group.entries.filter((entry) => {
      return entryMatchesTagFilter(
        entry,
        normalizedActiveTagFilters,
        tagPropertyIds,
      );
    }),
  }));
}
