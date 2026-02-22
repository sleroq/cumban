import { BasesEntryGroup, type BasesPropertyId, NullValue } from "obsidian";

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

export interface ParsedWikiLink {
  target: string;
  display: string;
}

export function parseWikiLinks(value: string): ParsedWikiLink[] {
  const regex = /\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|([^\]]+))?\]\]/g;
  const links: ParsedWikiLink[] = [];
  let match;

  while ((match = regex.exec(value)) !== null) {
    const target = match[1].trim();
    if (target.length === 0) continue;

    const alias = match[2]?.trim();
    const display = alias && alias.length > 0 ? alias : target;
    links.push({ target, display });
  }

  return links;
}

export function getPropertyValues(value: unknown): string[] | null {
  if (value === null || value === undefined || value instanceof NullValue) {
    return null;
  }

  // Handle arrays - each element is a separate value
  if (Array.isArray(value)) {
    const values = value
      .map((v) => {
        const str = String(v).trim();
        return str.length > 0 ? str : null;
      })
      .filter((v): v is string => v !== null);
    return values.length > 0 ? values : null;
  }

  const stringValue = String(value).trim();
  if (stringValue.length === 0) {
    return null;
  }

  // Handle comma-separated tags
  if (stringValue.includes(",")) {
    return stringValue
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  return [stringValue];
}

export function getColumnName(
  groupKey: unknown,
  emptyColumnLabel?: string,
): string {
  if (normalizeGroupKey(groupKey) === null) {
    return emptyColumnLabel ?? NO_VALUE_COLUMN;
  }

  return String(groupKey);
}

export function getColumnKey(groupKey: unknown): string {
  if (normalizeGroupKey(groupKey) === null) {
    return NO_VALUE_COLUMN_KEY;
  }

  return String(groupKey);
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

export function getHashColor(
  value: string,
  saturation = 80,
  lightness = 60,
  alpha = 0.5,
): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsla(${h}, ${saturation}%, ${lightness}%, ${alpha})`;
}
