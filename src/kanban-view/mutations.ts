import { App, BasesEntry, type BasesPropertyId } from "obsidian";

import {
  getTargetGroupValue,
  isSameGroupValue,
  resolveFrontmatterKey,
} from "./utils";

type CreateCardForColumnArgs = {
  groupByProperty: BasesPropertyId | null;
  groupByPropertyKey: string | null;
  groupKey: unknown;
  createFileForView: (
    filePath: string | undefined,
    updateFrontmatter: (frontmatter: Record<string, unknown>) => void,
  ) => Promise<void>;
};

type HandleDropArgs = {
  groupByProperty: BasesPropertyId | null;
  groupByPropertyKey: string | null;
  groupKey: unknown;
  draggedPaths: string[];
  entryByPath: Map<string, BasesEntry>;
};

export class KanbanMutationService {
  constructor(private readonly app: App) {}

  async createCardForColumn(args: CreateCardForColumnArgs): Promise<void> {
    const { groupByProperty, groupByPropertyKey, groupKey, createFileForView } =
      args;

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
    });
  }

  async handleDrop(args: HandleDropArgs): Promise<void> {
    const {
      groupByProperty,
      groupByPropertyKey,
      groupKey,
      draggedPaths,
      entryByPath,
    } = args;

    if (groupByProperty === null || groupByPropertyKey === null) {
      return;
    }

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
  }
}
