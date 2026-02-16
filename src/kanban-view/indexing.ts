import { BasesEntry } from "obsidian";

export type EntryGroupLike = {
  entries: BasesEntry[];
};

export function buildEntryIndexes(groups: EntryGroupLike[]): {
  entryByPath: Map<string, BasesEntry>;
  cardOrder: string[];
} {
  const entryByPath = new Map<string, BasesEntry>();
  const cardOrder: string[] = [];

  for (const group of groups) {
    for (const entry of group.entries) {
      const path = entry.file.path;
      entryByPath.set(path, entry);
      cardOrder.push(path);
    }
  }

  return { entryByPath, cardOrder };
}

export function getElementByDataset(
  rootEl: HTMLElement,
  selector: string,
  datasetKey: string,
  value: string,
): HTMLElement | null {
  const elements = rootEl.querySelectorAll<HTMLElement>(selector);
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements.item(index);
    if (element.dataset[datasetKey] === value) {
      return element;
    }
  }

  return null;
}
