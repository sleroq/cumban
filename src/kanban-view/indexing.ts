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
