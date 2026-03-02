import { App, TFile, parseYaml, stringifyYaml } from "obsidian";

type PersistBaseViewOrderArgs = {
  app: App;
  baseFile: TFile;
  viewType: string;
  viewName: string;
  viewId: string;
  viewIdOptionKey: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function reorderViewsWithCurrentFirst(
  content: string,
  viewType: string,
  viewName: string,
  viewId: string,
  viewIdOptionKey: string,
): string | null {
  const parsed = parseYaml(content) as unknown;
  if (!isRecord(parsed)) {
    return null;
  }

  const viewsValue = parsed.views;
  if (!Array.isArray(viewsValue) || viewsValue.length === 0) {
    return null;
  }
  const views: unknown[] = viewsValue;

  const firstMatchById = views.findIndex((value) => {
    if (!isRecord(value)) {
      return false;
    }
    return getString(value, viewIdOptionKey) === viewId;
  });

  const targetIndex =
    firstMatchById >= 0
      ? firstMatchById
      : views.findIndex((value) => {
          if (!isRecord(value)) {
            return false;
          }

          return (
            getString(value, "type") === viewType &&
            getString(value, "name") === viewName
          );
        });

  if (targetIndex < 0) {
    return null;
  }

  const targetView = views[targetIndex];
  if (!isRecord(targetView)) {
    return null;
  }

  let changed = false;
  if (getString(targetView, viewIdOptionKey) !== viewId) {
    targetView[viewIdOptionKey] = viewId;
    changed = true;
  }

  if (targetIndex !== 0) {
    const [movedView] = views.splice(targetIndex, 1);
    views.unshift(movedView);
    changed = true;
  }

  if (!changed) {
    return null;
  }

  return ensureTrailingNewline(stringifyYaml(parsed));
}

export async function persistCurrentBaseViewAsDefault(
  args: PersistBaseViewOrderArgs,
): Promise<boolean> {
  const { app, baseFile, viewType, viewName, viewId, viewIdOptionKey } = args;

  let wroteChanges = false;
  await app.vault.process(baseFile, (content) => {
    const nextContent = reorderViewsWithCurrentFirst(
      content,
      viewType,
      viewName,
      viewId,
      viewIdOptionKey,
    );
    if (nextContent === null) {
      return content;
    }

    wroteChanges = true;
    return nextContent;
  });

  return wroteChanges;
}
