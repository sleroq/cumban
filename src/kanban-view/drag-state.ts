import {
  derived,
  get,
  writable,
  type Readable,
  type Writable,
} from "svelte/store";

import { logDragEvent } from "./debug";

export type DragPlacement = "before" | "after";

export type DragSession =
  | { kind: "card"; sourcePath: string }
  | { kind: "column"; sourceKey: string }
  | null;

export type DragDropTarget =
  | {
      kind: "card";
      targetPath: string;
      targetColumnKey: string;
      placement: DragPlacement;
    }
  | { kind: "column"; targetKey: string; placement: DragPlacement }
  | null;

export type KanbanDragState = {
  session: Writable<DragSession>;
  dropTarget: Writable<DragDropTarget>;
  isDragging: Readable<boolean>;
  isCardDragging: Readable<boolean>;
  isColumnDragging: Readable<boolean>;
  cardSourcePath: Readable<string | null>;
  columnSourceKey: Readable<string | null>;
  startCardDrag: (filePath: string, dataTransfer: DataTransfer | null) => void;
  startColumnDrag: (
    columnKey: string,
    dataTransfer: DataTransfer | null,
  ) => void;
  endDrag: () => void;
  clearDropTarget: () => void;
  setCardDropTarget: (
    targetPath: string | null,
    targetColumnKey: string | null,
    placement: DragPlacement | null,
  ) => void;
  setColumnDropTarget: (
    targetKey: string | null,
    placement: DragPlacement | null,
  ) => void;
  getCardSourcePath: () => string | null;
  getColumnSourceKey: () => string | null;
  getCardPlacement: () => DragPlacement | null;
  getCardDropPlacement: (path: string) => DragPlacement | null;
  getColumnDropPlacement: (key: string) => DragPlacement | null;
  cardDropTargetStore: (path: string) => Readable<boolean>;
  cardDropPlacementStore: (path: string) => Readable<DragPlacement | null>;
  cardSourceStore: (path: string) => Readable<boolean>;
  columnDropTargetStore: (key: string) => Readable<boolean>;
  columnDropPlacementStore: (key: string) => Readable<DragPlacement | null>;
  columnSourceStore: (key: string) => Readable<boolean>;
};

export function createKanbanDragState(): KanbanDragState {
  const session = writable<DragSession>(null);
  const dropTarget = writable<DragDropTarget>(null);

  const isDragging = derived(session, ($session) => $session !== null);
  const isCardDragging = derived(
    session,
    ($session) => $session?.kind === "card",
  );
  const isColumnDragging = derived(
    session,
    ($session) => $session?.kind === "column",
  );
  const cardSourcePath = derived(session, ($session) =>
    $session?.kind === "card" ? $session.sourcePath : null,
  );
  const columnSourceKey = derived(session, ($session) =>
    $session?.kind === "column" ? $session.sourceKey : null,
  );

  const cardDropTargetCache = new Map<string, Readable<boolean>>();
  const cardDropPlacementCache = new Map<
    string,
    Readable<DragPlacement | null>
  >();
  const cardSourceCache = new Map<string, Readable<boolean>>();
  const columnDropTargetCache = new Map<string, Readable<boolean>>();
  const columnDropPlacementCache = new Map<
    string,
    Readable<DragPlacement | null>
  >();
  const columnSourceCache = new Map<string, Readable<boolean>>();

  function startCardDrag(
    filePath: string,
    dataTransfer: DataTransfer | null,
  ): void {
    session.set({ kind: "card", sourcePath: filePath });
    dropTarget.set(null);

    if (dataTransfer !== null) {
      dataTransfer.effectAllowed = "move";
      dataTransfer.setData("text/plain", filePath);
    }

    logDragEvent("Card drag started", { filePath });
  }

  function startColumnDrag(
    columnKey: string,
    dataTransfer: DataTransfer | null,
  ): void {
    session.set({ kind: "column", sourceKey: columnKey });
    dropTarget.set(null);

    if (dataTransfer !== null) {
      dataTransfer.effectAllowed = "move";
      dataTransfer.setData("text/plain", columnKey);
    }

    logDragEvent("Column drag started", { columnKey });
  }

  function clearDropTarget(): void {
    dropTarget.set(null);
  }

  function endDrag(): void {
    logDragEvent("Drag ended", {
      session: get(session),
      dropTarget: get(dropTarget),
    });
    session.set(null);
    dropTarget.set(null);
  }

  function setCardDropTarget(
    targetPath: string | null,
    targetColumnKey: string | null,
    placement: DragPlacement | null,
  ): void {
    if (targetPath === null || targetColumnKey === null || placement === null) {
      if (get(dropTarget) !== null) {
        dropTarget.set(null);
      }
      return;
    }

    const nextTarget: DragDropTarget = {
      kind: "card",
      targetPath,
      targetColumnKey,
      placement,
    };
    const current = get(dropTarget);
    if (
      current?.kind === "card" &&
      current.targetPath === nextTarget.targetPath &&
      current.targetColumnKey === nextTarget.targetColumnKey &&
      current.placement === nextTarget.placement
    ) {
      return;
    }

    dropTarget.set(nextTarget);
  }

  function setColumnDropTarget(
    targetKey: string | null,
    placement: DragPlacement | null,
  ): void {
    if (targetKey === null || placement === null) {
      if (get(dropTarget) !== null) {
        dropTarget.set(null);
      }
      return;
    }

    const nextTarget: DragDropTarget = {
      kind: "column",
      targetKey,
      placement,
    };
    const current = get(dropTarget);
    if (
      current?.kind === "column" &&
      current.targetKey === nextTarget.targetKey &&
      current.placement === nextTarget.placement
    ) {
      return;
    }

    dropTarget.set(nextTarget);
  }

  function getCardSourcePath(): string | null {
    const current = get(session);
    return current?.kind === "card" ? current.sourcePath : null;
  }

  function getColumnSourceKey(): string | null {
    const current = get(session);
    return current?.kind === "column" ? current.sourceKey : null;
  }

  function getCardPlacement(): DragPlacement | null {
    const current = get(dropTarget);
    return current?.kind === "card" ? current.placement : null;
  }

  function getCardDropPlacement(path: string): DragPlacement | null {
    const current = get(dropTarget);
    return current?.kind === "card" && current.targetPath === path
      ? current.placement
      : null;
  }

  function getColumnDropPlacement(key: string): DragPlacement | null {
    const current = get(dropTarget);
    return current?.kind === "column" && current.targetKey === key
      ? current.placement
      : null;
  }

  function cardDropTargetStore(path: string): Readable<boolean> {
    const cached = cardDropTargetCache.get(path);
    if (cached !== undefined) {
      return cached;
    }

    const store = derived(
      dropTarget,
      ($dropTarget) =>
        $dropTarget?.kind === "card" && $dropTarget.targetPath === path,
    );
    cardDropTargetCache.set(path, store);
    return store;
  }

  function cardDropPlacementStore(
    path: string,
  ): Readable<DragPlacement | null> {
    const cached = cardDropPlacementCache.get(path);
    if (cached !== undefined) {
      return cached;
    }

    const store = derived(dropTarget, ($dropTarget) =>
      $dropTarget?.kind === "card" && $dropTarget.targetPath === path
        ? $dropTarget.placement
        : null,
    );
    cardDropPlacementCache.set(path, store);
    return store;
  }

  function cardSourceStore(path: string): Readable<boolean> {
    const cached = cardSourceCache.get(path);
    if (cached !== undefined) {
      return cached;
    }

    const store = derived(
      session,
      ($session) => $session?.kind === "card" && $session.sourcePath === path,
    );
    cardSourceCache.set(path, store);
    return store;
  }

  function columnDropTargetStore(key: string): Readable<boolean> {
    const cached = columnDropTargetCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const store = derived(
      dropTarget,
      ($dropTarget) =>
        $dropTarget?.kind === "column" && $dropTarget.targetKey === key,
    );
    columnDropTargetCache.set(key, store);
    return store;
  }

  function columnDropPlacementStore(
    key: string,
  ): Readable<DragPlacement | null> {
    const cached = columnDropPlacementCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const store = derived(dropTarget, ($dropTarget) =>
      $dropTarget?.kind === "column" && $dropTarget.targetKey === key
        ? $dropTarget.placement
        : null,
    );
    columnDropPlacementCache.set(key, store);
    return store;
  }

  function columnSourceStore(key: string): Readable<boolean> {
    const cached = columnSourceCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const store = derived(
      session,
      ($session) => $session?.kind === "column" && $session.sourceKey === key,
    );
    columnSourceCache.set(key, store);
    return store;
  }

  return {
    session,
    dropTarget,
    isDragging,
    isCardDragging,
    isColumnDragging,
    cardSourcePath,
    columnSourceKey,
    startCardDrag,
    startColumnDrag,
    endDrag,
    clearDropTarget,
    setCardDropTarget,
    setColumnDropTarget,
    getCardSourcePath,
    getColumnSourceKey,
    getCardPlacement,
    getCardDropPlacement,
    getColumnDropPlacement,
    cardDropTargetStore,
    cardDropPlacementStore,
    cardSourceStore,
    columnDropTargetStore,
    columnDropPlacementStore,
    columnSourceStore,
  };
}
