import { App, BasesEntry, type BasesPropertyId } from "obsidian";
import type { TFile } from "obsidian";

import {
  getTargetGroupValue,
  isSameGroupValue,
  resolveFrontmatterKey,
} from "./utils";
import type { PropertyEditorMode } from "./actions";

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

type UpdateCardPropertyValuesArgs = {
  file: TFile;
  propertyId: BasesPropertyId;
  propertyKey: string;
  mode: PropertyEditorMode;
  values: string[];
};

type UpdateCardPropertyCheckboxArgs = {
  file: TFile;
  propertyId: BasesPropertyId;
  propertyKey: string;
  checked: boolean;
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

  async updateCardPropertyValues(
    args: UpdateCardPropertyValuesArgs,
  ): Promise<void> {
    const { file, propertyId, propertyKey, mode, values } = args;

    const trimmedValues = values
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const key = resolveFrontmatterKey(frontmatter, propertyId, propertyKey);
      if (trimmedValues.length === 0) {
        delete frontmatter[key];
        return;
      }

      if (mode === "single") {
        frontmatter[key] = trimmedValues[0];
        return;
      }

      frontmatter[key] = trimmedValues;
    });
  }

  async updateCardPropertyCheckbox(
    args: UpdateCardPropertyCheckboxArgs,
  ): Promise<void> {
    const { file, propertyId, propertyKey, checked } = args;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const key = resolveFrontmatterKey(frontmatter, propertyId, propertyKey);
      frontmatter[key] = checked;
    });
  }
}
