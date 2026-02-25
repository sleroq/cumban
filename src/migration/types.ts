export type LegacyKanbanCard = {
  text: string;
  title: string;
  linkTarget: string | null;
};

export type LegacyKanbanLane = {
  name: string;
  cards: LegacyKanbanCard[];
};

export type LegacyKanbanBoard = {
  lanes: LegacyKanbanLane[];
};

export type MigrationResult = {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  baseFilePath: string;
};
