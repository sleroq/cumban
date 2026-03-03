import {
  BasesEntry,
  BasesEntryGroup,
  type BasesPropertyId,
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

function isBasesPropertyId(value: string): value is BasesPropertyId {
  return /^note\.|^formula\.|^file\./.test(value);
}

function getPropertyIdFromUnknown(value: unknown): BasesPropertyId | null {
  if (typeof value === "string") {
    return isBasesPropertyId(value) ? value : null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = record.id;
  if (typeof id === "string") {
    return isBasesPropertyId(id) ? id : null;
  }

  const propertyId = record.propertyId;
  if (typeof propertyId === "string") {
    return isBasesPropertyId(propertyId) ? propertyId : null;
  }

  return null;
}

export function getSelectedProperties(properties: unknown): BasesPropertyId[] {
  if (!Array.isArray(properties)) {
    return [];
  }

  const selected = properties
    .map((property) => getPropertyIdFromUnknown(property))
    .filter((propertyId): propertyId is BasesPropertyId => {
      return propertyId !== null;
    });

  return Array.from(new Set(selected));
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

function splitTopLevelCommaSeparated(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let wikiDepth = 0;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const nextChar = i < value.length - 1 ? value[i + 1] : "";

    if (char === "[" && nextChar === "[") {
      wikiDepth += 1;
      current += "[[";
      i += 1;
      continue;
    }

    if (char === "]" && nextChar === "]") {
      if (wikiDepth > 0) {
        wikiDepth -= 1;
      }
      current += "]]";
      i += 1;
      continue;
    }

    if (char === "," && wikiDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    parts.push(trimmed);
  }

  return parts;
}

function toPropertyValueText(value: unknown): string | null {
  if (value instanceof NullValue) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "data")) {
      return toPropertyValueText(record.data);
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      prototype !== null &&
      prototype !== Object.prototype &&
      typeof (value as { toString: () => string }).toString === "function"
    ) {
      const text = (value as { toString: () => string }).toString().trim();
      return text.length > 0 ? text : null;
    }
  }

  return null;
}

export function getPropertyValues(value: unknown): string[] | null {
  if (value === null || value === undefined || value instanceof NullValue) {
    return null;
  }

  if (Array.isArray(value)) {
    const values = value
      .map((v) => toPropertyValueText(v))
      .filter((v): v is string => v !== null);
    return values.length > 0 ? values : null;
  }

  const stringValue = toPropertyValueText(value);
  if (stringValue === null) {
    return null;
  }

  if (stringValue.includes(",")) {
    return splitTopLevelCommaSeparated(stringValue);
  }

  return [stringValue];
}

export function normalizeTagDisplayValue(value: string): string {
  const trimmed = value.trim();
  const wikiLinks = parseWikiLinks(trimmed);
  if (
    wikiLinks.length === 1 &&
    trimmed.startsWith("[[") &&
    trimmed.endsWith("]]")
  ) {
    return wikiLinks[0].display;
  }

  if (trimmed.startsWith("#")) {
    return trimmed.slice(1).trim();
  }

  return trimmed;
}

export function normalizeTagFilterValue(value: string): string {
  return normalizeTagDisplayValue(value).toLowerCase();
}

export function getEntryTagValues(
  entry: BasesEntry,
  tagPropertyIds: BasesPropertyId[],
): string[] {
  const tagValues: string[] = [];
  const seenTagKeys = new Set<string>();

  for (const propertyId of tagPropertyIds) {
    const values = getPropertyValues(entry.getValue(propertyId));
    if (values === null) {
      continue;
    }

    for (const value of values) {
      const normalized = normalizeTagDisplayValue(value);
      if (normalized.length === 0) {
        continue;
      }

      const normalizedKey = normalized.toLowerCase();
      if (seenTagKeys.has(normalizedKey)) {
        continue;
      }

      seenTagKeys.add(normalizedKey);
      tagValues.push(normalized);
    }
  }

  return tagValues;
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
