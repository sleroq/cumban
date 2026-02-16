import { App, BasesEntry, BasesPropertyId, TFile } from "obsidian";

import {
  formatPropertyValue,
  getCardDropTargetFromColumn,
  getColumnName,
  parseSingleWikiLink,
} from "./utils";

type Placement = "before" | "after";

export type RenderContext = {
  selectedProperties: BasesPropertyId[];
  groupByProperty: BasesPropertyId | null;
  selectedPaths: Set<string>;
  getDraggingColumnKey: () => string | null;
  getDraggingSourcePath: () => string | null;
  getColumnDropPlacement: () => Placement | null;
  getCardDropPlacement: () => Placement | null;
  getCardDropTargetPath: () => string | null;
};

export type KanbanRendererHandlers = {
  onStartColumnDrag: (evt: DragEvent, columnKey: string) => void;
  onEndColumnDrag: () => void;
  onSetColumnDropIndicator: (columnKey: string, placement: Placement) => void;
  onClearColumnDropIndicator: () => void;
  onHandleColumnDrop: (columnKey: string, placement: Placement) => void;
  onCreateCardForColumn: (
    groupByProperty: BasesPropertyId | null,
    groupKey: unknown,
  ) => Promise<void>;
  onSetupCardDragBehavior: (cardEl: HTMLElement) => void;
  onSelectCard: (
    filePath: string,
    cardIndex: number,
    extendSelection: boolean,
  ) => void;
  onClearSelection: () => void;
  onStartCardDrag: (
    evt: DragEvent,
    filePath: string,
    cardIndex: number,
  ) => void;
  onEndCardDrag: () => void;
  onSetCardDropIndicator: (targetPath: string, placement: Placement) => void;
  onClearCardDropIndicator: () => void;
  onHandleDrop: (
    groupByProperty: BasesPropertyId | null,
    groupKey: unknown,
    targetPath: string | null,
    placement: Placement,
  ) => Promise<void>;
  onShowCardContextMenu: (evt: MouseEvent, file: TFile) => void;
};

export class KanbanRenderer {
  constructor(
    private readonly app: App,
    private readonly handlers: KanbanRendererHandlers,
  ) {}

  renderColumn(
    boardEl: HTMLElement,
    columnKey: string,
    groupKey: unknown,
    entries: BasesEntry[],
    startCardIndex: number,
    context: RenderContext,
  ): number {
    if (!boardEl.hasAttribute("data-selection-clear-bound")) {
      boardEl.setAttribute("data-selection-clear-bound", "true");
      boardEl.addEventListener("click", (evt) => {
        if ((evt.target as HTMLElement).closest(".bases-kanban-card") !== null) {
          return;
        }

        this.handlers.onClearSelection();
      });
    }

    const columnName = getColumnName(groupKey);
    const columnEl = boardEl.createDiv({ cls: "bases-kanban-column" });
    columnEl.dataset.columnKey = columnKey;
    const headerEl = columnEl.createDiv({ cls: "bases-kanban-column-header" });
    headerEl.draggable = true;
    headerEl.addClass("bases-kanban-column-handle");
    headerEl.addEventListener("dragstart", (evt) => {
      this.handlers.onStartColumnDrag(evt, columnKey);
    });
    headerEl.addEventListener("dragend", () => {
      this.handlers.onEndColumnDrag();
    });

    columnEl.addEventListener("dragover", (evt) => {
      if (context.getDraggingColumnKey() === null) {
        return;
      }

      evt.preventDefault();
      if (evt.dataTransfer !== null) {
        evt.dataTransfer.dropEffect = "move";
      }

      const rect = columnEl.getBoundingClientRect();
      const placement =
        evt.clientX < rect.left + rect.width / 2 ? "before" : "after";
      this.handlers.onSetColumnDropIndicator(columnKey, placement);
    });
    columnEl.addEventListener("dragleave", (evt) => {
      if (
        evt.relatedTarget instanceof Node &&
        columnEl.contains(evt.relatedTarget)
      ) {
        return;
      }

      if (evt.relatedTarget === null) {
        return;
      }

      this.handlers.onClearColumnDropIndicator();
    });
    columnEl.addEventListener("drop", (evt) => {
      if (context.getDraggingColumnKey() === null) {
        return;
      }

      evt.preventDefault();
      const placement = context.getColumnDropPlacement() ?? "before";
      this.handlers.onHandleColumnDrop(columnKey, placement);
    });

    headerEl.createEl("h3", { text: columnName });
    headerEl.createEl("span", {
      text: String(entries.length),
      cls: "bases-kanban-column-count",
    });

    const addCardButtonEl = headerEl.createEl("button", {
      text: "+",
      cls: "bases-kanban-add-card-button",
    });
    addCardButtonEl.type = "button";
    addCardButtonEl.ariaLabel = `Add card to ${columnName}`;
    addCardButtonEl.draggable = false;
    addCardButtonEl.addEventListener("mousedown", (evt) => {
      evt.stopPropagation();
    });
    addCardButtonEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void this.handlers.onCreateCardForColumn(
        context.groupByProperty,
        groupKey,
      );
    });

    const cardsEl = columnEl.createDiv({ cls: "bases-kanban-cards" });
    cardsEl.addEventListener("dragover", (evt) => {
      if (
        context.groupByProperty === null ||
        context.getDraggingSourcePath() === null
      ) {
        return;
      }

      evt.preventDefault();
      if (evt.dataTransfer !== null) {
        evt.dataTransfer.dropEffect = "move";
      }
      cardsEl.addClass("bases-kanban-drop-target");
      const dropTarget = getCardDropTargetFromColumn(cardsEl, evt.clientY);
      if (dropTarget === null) {
        this.handlers.onClearCardDropIndicator();
        return;
      }

      this.handlers.onSetCardDropIndicator(
        dropTarget.path,
        dropTarget.placement,
      );
    });
    cardsEl.addEventListener("dragleave", (evt) => {
      if (
        evt.relatedTarget instanceof Node &&
        cardsEl.contains(evt.relatedTarget)
      ) {
        return;
      }

      cardsEl.removeClass("bases-kanban-drop-target");
    });
    cardsEl.addEventListener("drop", (evt) => {
      evt.preventDefault();
      cardsEl.removeClass("bases-kanban-drop-target");
      const targetPath = context.getCardDropTargetPath();
      const placement = context.getCardDropPlacement() ?? "after";
      this.handlers.onClearCardDropIndicator();
      void this.handlers.onHandleDrop(
        context.groupByProperty,
        groupKey,
        targetPath,
        placement,
      );
    });
    let cardIndex = startCardIndex;
    for (const entry of entries) {
      this.renderCard(cardsEl, entry, groupKey, cardIndex, context);
      cardIndex += 1;
    }

    return cardIndex;
  }

  private renderCard(
    cardsEl: HTMLElement,
    entry: BasesEntry,
    groupKey: unknown,
    cardIndex: number,
    context: RenderContext,
  ): void {
    const title = entry.file.basename;
    const filePath = entry.file.path;
    const cardEl = cardsEl.createDiv({ cls: "bases-kanban-card" });
    cardEl.draggable = false;
    cardEl.dataset.cardPath = filePath;
    cardEl.toggleClass(
      "bases-kanban-card-selected",
      context.selectedPaths.has(filePath),
    );

    if (context.groupByProperty !== null) {
      this.handlers.onSetupCardDragBehavior(cardEl);
    }

    cardEl.addEventListener("click", (evt) => {
      if ((evt.target as HTMLElement).closest("a") !== null) {
        return;
      }

      this.handlers.onSelectCard(
        filePath,
        cardIndex,
        evt.shiftKey || evt.metaKey,
      );
    });
    cardEl.addEventListener("dragstart", (evt) => {
      this.handlers.onStartCardDrag(evt, filePath, cardIndex);
    });
    cardEl.addEventListener("dragend", () => {
      this.handlers.onEndCardDrag();
    });
    cardEl.addEventListener("dragover", (evt) => {
      if (
        context.groupByProperty === null ||
        context.getDraggingSourcePath() === null
      ) {
        return;
      }

      evt.preventDefault();
      evt.stopPropagation();
      if (evt.dataTransfer !== null) {
        evt.dataTransfer.dropEffect = "move";
      }

      const rect = cardEl.getBoundingClientRect();
      const placement =
        evt.clientY < rect.top + rect.height / 2 ? "before" : "after";
      this.handlers.onSetCardDropIndicator(filePath, placement);
    });
    cardEl.addEventListener("dragleave", (evt) => {
      if (
        evt.relatedTarget instanceof Node &&
        cardEl.contains(evt.relatedTarget)
      ) {
        return;
      }

      if (context.getCardDropTargetPath() === filePath) {
        this.handlers.onClearCardDropIndicator();
      }
    });
    cardEl.addEventListener("drop", (evt) => {
      if (
        context.groupByProperty === null ||
        context.getDraggingSourcePath() === null
      ) {
        return;
      }

      evt.preventDefault();
      evt.stopPropagation();
      const placement = context.getCardDropPlacement() ?? "after";
      this.handlers.onClearCardDropIndicator();
      void this.handlers.onHandleDrop(
        context.groupByProperty,
        groupKey,
        filePath,
        placement,
      );
    });
    cardEl.addEventListener("contextmenu", (evt) => {
      this.handlers.onShowCardContextMenu(evt, entry.file);
    });

    const titleEl = cardEl.createDiv({ cls: "bases-kanban-card-title" });
    const linkEl = titleEl.createEl("a", {
      text: title,
      cls: "internal-link",
    });

    linkEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void this.app.workspace.openLinkText(
        filePath,
        "",
        evt.ctrlKey || evt.metaKey,
      );
    });
    linkEl.addEventListener("contextmenu", (evt) => {
      this.handlers.onShowCardContextMenu(evt, entry.file);
    });

    const propertiesToDisplay = context.selectedProperties.filter(
      (propertyId) =>
        propertyId !== "file.name" && propertyId !== context.groupByProperty,
    );

    if (propertiesToDisplay.length === 0) {
      return;
    }

    const propertiesEl = cardEl.createDiv({
      cls: "bases-kanban-card-properties",
    });
    for (const propertyId of propertiesToDisplay) {
      const value = formatPropertyValue(entry.getValue(propertyId));
      if (value === null) {
        continue;
      }

      const rowEl = propertiesEl.createDiv({
        cls: "bases-kanban-property-row",
      });
      const wikiLink = parseSingleWikiLink(value);
      if (wikiLink === null) {
        rowEl.createSpan({
          cls: "bases-kanban-property-value",
          text: value,
        });
        continue;
      }

      const valueLinkEl = rowEl.createEl("a", {
        cls: "bases-kanban-property-value internal-link",
        text: wikiLink.display,
      });

      valueLinkEl.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        void this.app.workspace.openLinkText(
          wikiLink.target,
          "",
          evt.ctrlKey || evt.metaKey,
        );
      });
    }

    if (propertiesEl.childElementCount === 0) {
      propertiesEl.remove();
    }
  }
}
