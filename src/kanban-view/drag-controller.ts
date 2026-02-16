export class KanbanDragController {
  private draggingSourcePath: string | null = null;
  private draggingColumnKey: string | null = null;
  private columnDropTargetKey: string | null = null;
  private columnDropPlacement: "before" | "after" | null = null;
  private cardDropTargetPath: string | null = null;
  private cardDropPlacement: "before" | "after" | null = null;

  constructor(private readonly rootEl: HTMLElement) {}

  getCardDragSourcePath(): string | null {
    return this.draggingSourcePath;
  }

  getColumnDragSourceKey(): string | null {
    return this.draggingColumnKey;
  }

  getColumnDropPlacement(): "before" | "after" | null {
    return this.columnDropPlacement;
  }

  getCardDropTargetPath(): string | null {
    return this.cardDropTargetPath;
  }

  getCardDropPlacement(): "before" | "after" | null {
    return this.cardDropPlacement;
  }

  startCardDrag(evt: DragEvent, filePath: string): void {
    this.draggingSourcePath = filePath;
    if (evt.dataTransfer !== null) {
      evt.dataTransfer.effectAllowed = "move";
      evt.dataTransfer.setData("text/plain", filePath);
    }
  }

  endCardDrag(): void {
    this.draggingSourcePath = null;
    this.clearCardDropIndicator();

    const draggingCards = this.rootEl.querySelectorAll<HTMLElement>(
      ".bases-kanban-card-dragging",
    );
    draggingCards.forEach((cardEl) => {
      cardEl.removeClass("bases-kanban-card-dragging");
    });

    const dropTargets = this.rootEl.querySelectorAll<HTMLElement>(
      ".bases-kanban-drop-target",
    );
    dropTargets.forEach((cardsEl) => {
      cardsEl.removeClass("bases-kanban-drop-target");
    });
  }

  setCardDropIndicator(
    targetPath: string,
    placement: "before" | "after",
    getCardEl: (path: string) => HTMLElement | null,
  ): void {
    if (
      this.cardDropTargetPath === targetPath &&
      this.cardDropPlacement === placement
    ) {
      return;
    }

    this.clearCardDropIndicator();
    this.cardDropTargetPath = targetPath;
    this.cardDropPlacement = placement;

    const cardEl = getCardEl(targetPath);
    if (cardEl === null) {
      return;
    }

    cardEl.addClass(
      placement === "before"
        ? "bases-kanban-card-drop-before"
        : "bases-kanban-card-drop-after",
    );
  }

  clearCardDropIndicator(): void {
    const indicators = this.rootEl.querySelectorAll<HTMLElement>(
      ".bases-kanban-card-drop-before, .bases-kanban-card-drop-after",
    );
    indicators.forEach((cardEl) => {
      cardEl.removeClass("bases-kanban-card-drop-before");
      cardEl.removeClass("bases-kanban-card-drop-after");
    });
    this.cardDropTargetPath = null;
    this.cardDropPlacement = null;
  }

  startColumnDrag(evt: DragEvent, columnKey: string): void {
    this.draggingColumnKey = columnKey;
    this.clearColumnDropIndicator();
    if (evt.dataTransfer !== null) {
      evt.dataTransfer.effectAllowed = "move";
      evt.dataTransfer.setData("text/plain", columnKey);
    }
  }

  endColumnDrag(): void {
    this.draggingColumnKey = null;
    this.clearColumnDropIndicator();
  }

  setColumnDropIndicator(
    columnKey: string,
    placement: "before" | "after",
    getColumnEl: (key: string) => HTMLElement | null,
  ): void {
    if (
      this.columnDropTargetKey === columnKey &&
      this.columnDropPlacement === placement
    ) {
      return;
    }

    this.clearColumnDropIndicator();
    this.columnDropTargetKey = columnKey;
    this.columnDropPlacement = placement;

    const columnEl = getColumnEl(columnKey);
    if (columnEl === null) {
      return;
    }

    columnEl.addClass(
      placement === "before"
        ? "bases-kanban-column-drop-before"
        : "bases-kanban-column-drop-after",
    );
  }

  clearColumnDropIndicator(): void {
    const indicators = this.rootEl.querySelectorAll<HTMLElement>(
      ".bases-kanban-column-drop-before, .bases-kanban-column-drop-after",
    );
    indicators.forEach((columnEl) => {
      columnEl.removeClass("bases-kanban-column-drop-before");
      columnEl.removeClass("bases-kanban-column-drop-after");
    });
    this.columnDropTargetKey = null;
    this.columnDropPlacement = null;
  }
}
