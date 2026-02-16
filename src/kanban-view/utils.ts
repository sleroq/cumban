import {
  BasesEntry,
  BasesEntryGroup,
  BasesPropertyId,
  NullValue,
} from "obsidian";

import { NO_VALUE_COLUMN, NO_VALUE_COLUMN_KEY } from "./constants";

export function hasConfiguredGroupBy(
  groups: Array<{ key?: unknown }>,
): boolean {
  return groups.some((group) => !isNoValueGroupKey(group.key));
}

function isNoValueGroupKey(groupKey: unknown): boolean {
  if (
    groupKey === undefined ||
    groupKey === null ||
    groupKey instanceof NullValue
  ) {
    return true;
  }

  return typeof groupKey === "string" && groupKey.trim().length === 0;
}

function normalizeGroupKey(groupKey: unknown): string | null {
  if (isNoValueGroupKey(groupKey)) {
    return null;
  }

  return String(groupKey);
}

export function getSelectedProperties(properties: unknown): BasesPropertyId[] {
  if (!Array.isArray(properties)) {
    return [];
  }

  return properties.filter((propertyId): propertyId is BasesPropertyId => {
    return typeof propertyId === "string";
  });
}

export function getPropertyCandidates(
  selectedProperties: BasesPropertyId[],
  allProperties: BasesPropertyId[],
): BasesPropertyId[] {
  if (allProperties.length === 0) {
    return selectedProperties;
  }

  const propertyIds = new Set<BasesPropertyId>(selectedProperties);
  for (const propertyId of allProperties) {
    propertyIds.add(propertyId);
  }

  return [...propertyIds];
}

export function detectGroupByProperty(
  groups: BasesEntryGroup[],
  selectedProperties: BasesPropertyId[],
): BasesPropertyId | null {
  const groupsWithValues = groups.filter(
    (group) => !isNoValueGroupKey(group.key) && group.entries.length > 0,
  );

  if (groupsWithValues.length === 0) {
    return null;
  }

  for (const propertyId of selectedProperties) {
    if (propertyId === "file.name") {
      continue;
    }

    const matchesAllGroups = groupsWithValues.every((group) => {
      const groupKey = String(group.key);
      return group.entries.every((entry) => {
        const value = entry.getValue(propertyId);
        if (
          value === null ||
          value === undefined ||
          value instanceof NullValue
        ) {
          return false;
        }

        return String(value) === groupKey;
      });
    });

    if (matchesAllGroups) {
      return propertyId;
    }
  }

  return null;
}

export function formatPropertyValue(value: unknown): string | null {
  if (value === null || value === undefined || value instanceof NullValue) {
    return null;
  }

  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}

export function parseSingleWikiLink(
  value: string,
): { target: string; display: string } | null {
  const match = value.match(/^\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|([^\]]+))?\]\]$/);
  if (match === null) {
    return null;
  }

  const target = match[1].trim();
  if (target.length === 0) {
    return null;
  }

  const alias = match[2]?.trim();
  const display = alias && alias.length > 0 ? alias : target;
  return { target, display };
}

export function getColumnName(groupKey: unknown): string {
  if (normalizeGroupKey(groupKey) === null) {
    return NO_VALUE_COLUMN;
  }

  return String(groupKey);
}

export function getColumnKey(groupKey: unknown): string {
  if (normalizeGroupKey(groupKey) === null) {
    return NO_VALUE_COLUMN_KEY;
  }

  return String(groupKey);
}

export function sortRange(start: number, end: number): [number, number] {
  return start <= end ? [start, end] : [end, start];
}

export function getWritablePropertyKey(
  propertyId: BasesPropertyId,
): string | null {
  if (propertyId.startsWith("file.") || propertyId.startsWith("formula.")) {
    return null;
  }

  const lastDotIndex = propertyId.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === propertyId.length - 1) {
    return propertyId;
  }

  return propertyId.slice(lastDotIndex + 1);
}

export function reorderPaths(
  paths: string[],
  movedPath: string,
  targetPath: string | null,
  placement: "before" | "after",
): string[] {
  if (targetPath === movedPath) {
    return paths;
  }

  const nextPaths = paths.filter((path) => path !== movedPath);
  if (targetPath === null) {
    nextPaths.push(movedPath);
    return nextPaths;
  }

  const targetIndex = nextPaths.indexOf(targetPath);
  if (targetIndex === -1) {
    nextPaths.push(movedPath);
    return nextPaths;
  }

  const insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
  nextPaths.splice(insertionIndex, 0, movedPath);
  return nextPaths;
}

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value instanceof NullValue) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function getCardDropTargetFromColumn(
  cardsEl: HTMLElement,
  clientY: number,
): { path: string; placement: "before" | "after" } | null {
  const cards = cardsEl.querySelectorAll<HTMLElement>(".bases-kanban-card");
  if (cards.length === 0) {
    return null;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPath: string | null = null;
  let bestPlacement: "before" | "after" = "after";

  cards.forEach((cardEl) => {
    const path = cardEl.dataset.cardPath;
    if (typeof path !== "string" || path.length === 0) {
      return;
    }

    const rect = cardEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const distance = Math.abs(clientY - midY);
    if (distance >= bestDistance) {
      return;
    }

    bestDistance = distance;
    bestPath = path;
    bestPlacement = clientY < midY ? "before" : "after";
  });

  if (bestPath === null) {
    return null;
  }

  return { path: bestPath, placement: bestPlacement };
}

export function sortEntriesByRank(
  entries: BasesEntry[],
  sortConfig: { propertyId: BasesPropertyId; direction: "ASC" | "DESC" },
): BasesEntry[] {
  const rankedEntries = entries.map((entry, index) => {
    const rank = toFiniteNumber(entry.getValue(sortConfig.propertyId));
    return {
      entry,
      rank,
      index,
    };
  });

  rankedEntries.sort((a, b) => {
    if (a.rank === null && b.rank === null) {
      return a.index - b.index;
    }

    if (a.rank === null) {
      return 1;
    }

    if (b.rank === null) {
      return -1;
    }

    const difference =
      sortConfig.direction === "ASC" ? a.rank - b.rank : b.rank - a.rank;
    if (difference !== 0) {
      return difference;
    }

    return a.index - b.index;
  });

  return rankedEntries.map((entry) => entry.entry);
}

export function getTargetGroupValue(groupKey: unknown): string | null {
  return normalizeGroupKey(groupKey);
}

export function isSameGroupValue(
  currentValue: unknown,
  targetValue: string | null,
): boolean {
  return normalizeGroupKey(currentValue) === targetValue;
}

export function resolveFrontmatterKey(
  frontmatter: Record<string, unknown>,
  propertyId: BasesPropertyId,
  propertyKey: string,
): string {
  if (Object.prototype.hasOwnProperty.call(frontmatter, propertyId)) {
    return propertyId;
  }

  if (Object.prototype.hasOwnProperty.call(frontmatter, propertyKey)) {
    return propertyKey;
  }

  return propertyKey;
}
