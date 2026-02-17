/**
 * Drag and drop state management for Svelte Kanban components.
 * Uses Svelte stores for reactive state (runes only work in .svelte files).
 */

import { writable, derived, get, type Writable, type Readable } from "svelte/store";
import { logDragEvent } from "./debug";

// Card drag state types
export type CardDragState = {
  sourcePath: string | null;
  targetPath: string | null;
  placement: "before" | "after" | null;
};

// Column drag state types
export type ColumnDragState = {
  sourceKey: string | null;
  targetKey: string | null;
  placement: "before" | "after" | null;
};

// Create card drag state stores
export function createCardDragState(): {
  sourcePath: Writable<string | null>;
  targetPath: Writable<string | null>;
  placement: Writable<"before" | "after" | null>;
  isDragging: Readable<boolean>;
  startDrag: (filePath: string, dataTransfer: DataTransfer | null) => void;
  endDrag: () => void;
  setDropTarget: (targetPath: string | null, newPlacement: "before" | "after" | null) => void;
  clearDropTarget: () => void;
  isDropTarget: (path: string) => boolean;
  getDropPlacement: (path: string) => "before" | "after" | null;
  isDraggingSource: (path: string) => boolean;
  getSourcePath: () => string | null;
  getTargetPath: () => string | null;
  getPlacement: () => "before" | "after" | null;
} {
  const sourcePath = writable<string | null>(null);
  const targetPath = writable<string | null>(null);
  const placement = writable<"before" | "after" | null>(null);

  const isDragging = derived(sourcePath, ($sourcePath) => $sourcePath !== null);

  return {
    sourcePath,
    targetPath,
    placement,
    isDragging,

    startDrag(filePath: string, dataTransfer: DataTransfer | null): void {
      sourcePath.set(filePath);
      targetPath.set(null);
      placement.set(null);

      if (dataTransfer !== null) {
        dataTransfer.effectAllowed = "move";
        dataTransfer.setData("text/plain", filePath);
      }

      logDragEvent("Card drag started (Svelte store)", { filePath });
    },

    endDrag(): void {
      logDragEvent("Card drag ended (Svelte store)", {
        sourcePath: get(sourcePath),
        targetPath: get(targetPath),
        placement: get(placement),
      });

      sourcePath.set(null);
      targetPath.set(null);
      placement.set(null);
    },

    setDropTarget(newTargetPath: string | null, newPlacement: "before" | "after" | null): void {
      if (get(targetPath) === newTargetPath && get(placement) === newPlacement) {
        return;
      }
      targetPath.set(newTargetPath);
      placement.set(newPlacement);
    },

    clearDropTarget(): void {
      targetPath.set(null);
      placement.set(null);
    },

    isDropTarget(path: string): boolean {
      return get(targetPath) === path;
    },

    getDropPlacement(path: string): "before" | "after" | null {
      return get(targetPath) === path ? get(placement) : null;
    },

    isDraggingSource(path: string): boolean {
      return get(sourcePath) === path;
    },

    getSourcePath(): string | null {
      return get(sourcePath);
    },

    getTargetPath(): string | null {
      return get(targetPath);
    },

    getPlacement(): "before" | "after" | null {
      return get(placement);
    },
  };
}

// Create column drag state stores
export function createColumnDragState(): {
  sourceKey: Writable<string | null>;
  targetKey: Writable<string | null>;
  placement: Writable<"before" | "after" | null>;
  isDragging: Readable<boolean>;
  startDrag: (columnKey: string, dataTransfer: DataTransfer | null) => void;
  endDrag: () => void;
  setDropTarget: (targetKey: string | null, newPlacement: "before" | "after" | null) => void;
  clearDropTarget: () => void;
  isDropTarget: (key: string) => boolean;
  getDropPlacement: (key: string) => "before" | "after" | null;
  isDraggingSource: (key: string) => boolean;
  getSourceKey: () => string | null;
  getTargetKey: () => string | null;
  getPlacement: () => "before" | "after" | null;
} {
  const sourceKey = writable<string | null>(null);
  const targetKey = writable<string | null>(null);
  const placement = writable<"before" | "after" | null>(null);

  const isDragging = derived(sourceKey, ($sourceKey) => $sourceKey !== null);

  return {
    sourceKey,
    targetKey,
    placement,
    isDragging,

    startDrag(columnKey: string, dataTransfer: DataTransfer | null): void {
      sourceKey.set(columnKey);
      targetKey.set(null);
      placement.set(null);

      if (dataTransfer !== null) {
        dataTransfer.effectAllowed = "move";
        dataTransfer.setData("text/plain", columnKey);
      }

      logDragEvent("Column drag started (Svelte store)", { columnKey });
    },

    endDrag(): void {
      logDragEvent("Column drag ended (Svelte store)", {
        sourceKey: get(sourceKey),
        targetKey: get(targetKey),
        placement: get(placement),
      });

      sourceKey.set(null);
      targetKey.set(null);
      placement.set(null);
    },

    setDropTarget(newTargetKey: string | null, newPlacement: "before" | "after" | null): void {
      if (get(targetKey) === newTargetKey && get(placement) === newPlacement) {
        return;
      }
      targetKey.set(newTargetKey);
      placement.set(newPlacement);
    },

    clearDropTarget(): void {
      targetKey.set(null);
      placement.set(null);
    },

    isDropTarget(key: string): boolean {
      return get(targetKey) === key;
    },

    getDropPlacement(key: string): "before" | "after" | null {
      return get(targetKey) === key ? get(placement) : null;
    },

    isDraggingSource(key: string): boolean {
      return get(sourceKey) === key;
    },

    getSourceKey(): string | null {
      return get(sourceKey);
    },

    getTargetKey(): string | null {
      return get(targetKey);
    },

    getPlacement(): "before" | "after" | null {
      return get(placement);
    },
  };
}

// Calculate drop placement for a card based on mouse position
export function calculateCardDropPlacement(
  evt: DragEvent,
  cardRect: DOMRect,
): "before" | "after" {
  const midY = cardRect.top + cardRect.height / 2;
  return evt.clientY < midY ? "before" : "after";
}

// Calculate drop placement for a column based on mouse position
export function calculateColumnDropPlacement(
  evt: DragEvent,
  columnRect: DOMRect,
): "before" | "after" {
  const midX = columnRect.left + columnRect.width / 2;
  return evt.clientX < midX ? "before" : "after";
}
