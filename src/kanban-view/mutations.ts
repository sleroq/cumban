import { App, BasesEntry, BasesEntryGroup, BasesPropertyId } from "obsidian";

import {
  getTargetGroupValue,
  isSameGroupValue,
  reorderPaths,
  resolveFrontmatterKey,
  toFiniteNumber,
} from "./utils";

type WritableSortConfig = {
  propertyId: BasesPropertyId;
  propertyKey: string;
  direction: "ASC" | "DESC";
};

type CreateCardForColumnArgs = {
  groupByProperty: BasesPropertyId | null;
  groupByPropertyKey: string | null;
  groupKey: unknown;
  cardSortConfig: WritableSortConfig | null;
  newCardRank: number | null;
  createFileForView: (
    filePath: string | undefined,
    updateFrontmatter: (frontmatter: Record<string, unknown>) => void,
  ) => Promise<void>;
};

type HandleDropArgs = {
  groupByProperty: BasesPropertyId | null;
  groupByPropertyKey: string | null;
  groupKey: unknown;
  targetPath: string | null;
  placement: "before" | "after";
  draggingSourcePath: string;
  draggedPaths: string[];
  entryByPath: Map<string, BasesEntry>;
  getColumnCardPaths: (columnKey: string) => string[];
  getColumnKey: (groupKey: unknown) => string;
  sortConfig: WritableSortConfig | null;
};

export class KanbanMutationService {
  constructor(private readonly app: App) {}

  async createCardForColumn(args: CreateCardForColumnArgs): Promise<void> {
    const {
      groupByProperty,
      groupByPropertyKey,
      groupKey,
      cardSortConfig,
      newCardRank,
      createFileForView,
    } = args;

    const targetValue = getTargetGroupValue(groupKey);
    await createFileForView(undefined, (frontmatter) => {
      if (groupByProperty !== null && groupByPropertyKey !== null) {
        const key = resolveFrontmatterKey(
          frontmatter,
          groupByProperty,
          groupByPropertyKey,
        );
        if (targetValue === null) {
          delete frontmatter[key];
        } else {
          frontmatter[key] = targetValue;
        }
      }

      if (cardSortConfig !== null && newCardRank !== null) {
        const rankKey = resolveFrontmatterKey(
          frontmatter,
          cardSortConfig.propertyId,
          cardSortConfig.propertyKey,
        );
        frontmatter[rankKey] = newCardRank;
      }
    });
  }

  getNewCardRankForColumn(
    groups: BasesEntryGroup[],
    groupKey: unknown,
    sortPropertyId: BasesPropertyId,
    direction: "ASC" | "DESC",
  ): number {
    const targetValue = getTargetGroupValue(groupKey);
    const entries = groups.flatMap((group) =>
      isSameGroupValue(group.key, targetValue) ? group.entries : [],
    );

    let edgeRank: number | null = null;
    for (const entry of entries) {
      const rank = toFiniteNumber(entry.getValue(sortPropertyId));
      if (rank === null) {
        continue;
      }

      if (edgeRank === null) {
        edgeRank = rank;
        continue;
      }

      edgeRank =
        direction === "ASC"
          ? Math.min(edgeRank, rank)
          : Math.max(edgeRank, rank);
    }

    if (edgeRank === null) {
      return 1;
    }

    return direction === "ASC" ? edgeRank - 1 : edgeRank + 1;
  }

  async handleDrop(args: HandleDropArgs): Promise<void> {
    const {
      groupByProperty,
      groupByPropertyKey,
      groupKey,
      targetPath,
      placement,
      draggingSourcePath,
      draggedPaths,
      entryByPath,
      getColumnCardPaths,
      getColumnKey,
      sortConfig,
    } = args;

    if (groupByProperty === null || groupByPropertyKey === null) {
      return;
    }

    const sourceEntry = entryByPath.get(draggingSourcePath);
    const sourceColumnKey =
      sourceEntry === undefined
        ? null
        : getColumnKey(sourceEntry.getValue(groupByProperty));
    const targetColumnKey = getColumnKey(groupKey);
    const targetValue = getTargetGroupValue(groupKey);

    for (const path of draggedPaths) {
      const entry = entryByPath.get(path);
      if (entry === undefined) {
        continue;
      }

      const currentValue = entry.getValue(groupByProperty);
      if (isSameGroupValue(currentValue, targetValue)) {
        continue;
      }

      await this.app.fileManager.processFrontMatter(
        entry.file,
        (frontmatter) => {
          const key = resolveFrontmatterKey(
            frontmatter,
            groupByProperty,
            groupByPropertyKey,
          );
          if (targetValue === null) {
            delete frontmatter[key];
            return;
          }

          frontmatter[key] = targetValue;
        },
      );
    }

    if (sortConfig === null) {
      return;
    }

    if (targetPath !== null || sourceColumnKey === targetColumnKey) {
      const targetColumnPaths = getColumnCardPaths(targetColumnKey);
      const reorderedPaths = reorderPaths(
        targetColumnPaths,
        draggingSourcePath,
        targetPath,
        placement,
      );
      await this.writeCardSortOrder(reorderedPaths, sortConfig, entryByPath);
    }

    if (sourceColumnKey !== null && sourceColumnKey !== targetColumnKey) {
      const sourceColumnPaths = getColumnCardPaths(sourceColumnKey).filter(
        (path) => path !== draggingSourcePath,
      );
      await this.writeCardSortOrder(sourceColumnPaths, sortConfig, entryByPath);
    }
  }

  async writeCardSortOrder(
    orderedPaths: string[],
    sortConfig: WritableSortConfig,
    entryByPath: Map<string, BasesEntry>,
  ): Promise<void> {
    const total = orderedPaths.length;
    for (let index = 0; index < total; index += 1) {
      const path = orderedPaths[index];
      const entry = entryByPath.get(path);
      if (entry === undefined) {
        continue;
      }

      const rank = sortConfig.direction === "ASC" ? index + 1 : total - index;
      const currentRank = toFiniteNumber(entry.getValue(sortConfig.propertyId));
      if (currentRank !== null && currentRank === rank) {
        continue;
      }

      await this.app.fileManager.processFrontMatter(
        entry.file,
        (frontmatter) => {
          const key = resolveFrontmatterKey(
            frontmatter,
            sortConfig.propertyId,
            sortConfig.propertyKey,
          );
          frontmatter[key] = rank;
        },
      );
    }
  }
}
