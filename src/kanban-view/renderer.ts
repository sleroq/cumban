import { App, BasesEntry, BasesPropertyId, TFile } from "obsidian";

import {
  getCardDropTargetFromColumn,
  getColumnName,
  getHashColor,
  getPropertyValues,
  parseWikiLinks,
  type ParsedWikiLink,
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
  emptyColumnLabel: string;
  addCardButtonText: string;
  cardTitleSource: "basename" | "filename" | "path";
  cardTitleMaxLength: number;
  propertyValueSeparator: string;
  tagPropertySuffix: string;
  tagSaturation: number;
  tagLightness: number;
  tagAlpha: number;
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
  onKeyDown: (evt: KeyboardEvent) => void;
  onColumnScroll: (columnKey: string, scrollTop: number) => void;
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
    if (!boardEl.hasAttribute("data-keyboard-bound")) {
      boardEl.setAttribute("data-keyboard-bound", "true");
      boardEl.setAttribute("tabindex", "0");
      boardEl.addEventListener("keydown", (evt) => {
        this.handlers.onKeyDown(evt);
      });
      boardEl.addEventListener("click", (evt) => {
        if ((evt.target as HTMLElement).closest(".bases-kanban-card") !== null) {
          return;
        }

        this.handlers.onClearSelection();
      });
    }

    const columnName = getColumnName(groupKey, context.emptyColumnLabel);
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

    let latestColumnDragClientX = 0;
    let columnDragOverFrameId: number | null = null;
    columnEl.addEventListener("dragover", (evt) => {
      if (context.getDraggingColumnKey() === null) {
        return;
      }

      evt.preventDefault();
      if (evt.dataTransfer !== null) {
        evt.dataTransfer.dropEffect = "move";
      }

      latestColumnDragClientX = evt.clientX;
      if (columnDragOverFrameId !== null) {
        return;
      }

      columnDragOverFrameId = window.requestAnimationFrame(() => {
        columnDragOverFrameId = null;
        if (context.getDraggingColumnKey() === null) {
          return;
        }

        const rect = columnEl.getBoundingClientRect();
        const placement =
          latestColumnDragClientX < rect.left + rect.width / 2
            ? "before"
            : "after";
        this.handlers.onSetColumnDropIndicator(columnKey, placement);
      });
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

      if (columnDragOverFrameId !== null) {
        window.cancelAnimationFrame(columnDragOverFrameId);
        columnDragOverFrameId = null;
      }

      this.handlers.onClearColumnDropIndicator();
    });
    columnEl.addEventListener("drop", (evt) => {
      if (context.getDraggingColumnKey() === null) {
        return;
      }

      evt.preventDefault();
      if (columnDragOverFrameId !== null) {
        window.cancelAnimationFrame(columnDragOverFrameId);
        columnDragOverFrameId = null;
      }
      const placement = context.getColumnDropPlacement() ?? "before";
      this.handlers.onHandleColumnDrop(columnKey, placement);
    });

    headerEl.createEl("h3", { text: columnName });
    headerEl.createEl("span", {
      text: String(entries.length),
      cls: "bases-kanban-column-count",
    });

    const addCardButtonEl = headerEl.createEl("button", {
      text: context.addCardButtonText,
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
    let latestCardsDragClientY = 0;
    let cardsDragOverFrameId: number | null = null;
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

      latestCardsDragClientY = evt.clientY;
      if (cardsDragOverFrameId !== null) {
        return;
      }

      cardsDragOverFrameId = window.requestAnimationFrame(() => {
        cardsDragOverFrameId = null;
        if (
          context.groupByProperty === null ||
          context.getDraggingSourcePath() === null
        ) {
          return;
        }

        const dropTarget = getCardDropTargetFromColumn(
          cardsEl,
          latestCardsDragClientY,
        );
        if (dropTarget === null) {
          this.handlers.onClearCardDropIndicator();
          return;
        }

        this.handlers.onSetCardDropIndicator(
          dropTarget.path,
          dropTarget.placement,
        );
      });
    });
    cardsEl.addEventListener("dragleave", (evt) => {
      if (
        evt.relatedTarget instanceof Node &&
        cardsEl.contains(evt.relatedTarget)
      ) {
        return;
      }

      if (cardsDragOverFrameId !== null) {
        window.cancelAnimationFrame(cardsDragOverFrameId);
        cardsDragOverFrameId = null;
      }

      cardsEl.removeClass("bases-kanban-drop-target");
    });
    cardsEl.addEventListener("drop", (evt) => {
      evt.preventDefault();
      if (cardsDragOverFrameId !== null) {
        window.cancelAnimationFrame(cardsDragOverFrameId);
        cardsDragOverFrameId = null;
      }
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

  private renderWikiLinks(
    containerEl: HTMLElement,
    links: ParsedWikiLink[],
    isTagProperty: boolean = false,
    propertyValueSeparator: string = ", ",
    tagSaturation = 80,
    tagLightness = 60,
    tagAlpha = 0.5,
  ): void {
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const cls = isTagProperty
        ? "bases-kanban-property-value internal-link bases-kanban-property-link bases-kanban-property-tag"
        : "bases-kanban-property-value internal-link bases-kanban-property-link";
      const linkEl = containerEl.createEl("a", {
        cls,
        text: link.display,
      });
      if (isTagProperty) {
        linkEl.style.backgroundColor = getHashColor(
          link.display,
          tagSaturation,
          tagLightness,
          tagAlpha,
        );
      }

      linkEl.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        // Check for Cmd+Option+Click (Mac) or Ctrl+Alt+Click (Windows/Linux) to open to the right
        const isNewTab = evt.ctrlKey || evt.metaKey;
        const isOpenToRight = isNewTab && evt.altKey;
        void this.app.workspace.openLinkText(
          link.target,
          "",
          isOpenToRight ? "split" : isNewTab,
        );
      });

      // Add separator between links (not after last) - skip for tag properties
      if (!isTagProperty && i < links.length - 1) {
        containerEl.createSpan({
          cls: "bases-kanban-property-separator",
          text: propertyValueSeparator,
        });
      }
    }
  }

  private renderCard(
    cardsEl: HTMLElement,
    entry: BasesEntry,
    groupKey: unknown,
    cardIndex: number,
    context: RenderContext,
  ): void {
    const fullTitle = this.getCardTitle(entry, context.cardTitleSource);
    const title = this.truncateTitle(fullTitle, context.cardTitleMaxLength);
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
    let latestCardDragClientY = 0;
    let cardDragOverFrameId: number | null = null;
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

      latestCardDragClientY = evt.clientY;
      if (cardDragOverFrameId !== null) {
        return;
      }

      cardDragOverFrameId = window.requestAnimationFrame(() => {
        cardDragOverFrameId = null;
        if (
          context.groupByProperty === null ||
          context.getDraggingSourcePath() === null
        ) {
          return;
        }

        const rect = cardEl.getBoundingClientRect();
        const placement =
          latestCardDragClientY < rect.top + rect.height / 2
            ? "before"
            : "after";
        this.handlers.onSetCardDropIndicator(filePath, placement);
      });
    });
    cardEl.addEventListener("dragleave", (evt) => {
      if (
        evt.relatedTarget instanceof Node &&
        cardEl.contains(evt.relatedTarget)
      ) {
        return;
      }

      if (cardDragOverFrameId !== null) {
        window.cancelAnimationFrame(cardDragOverFrameId);
        cardDragOverFrameId = null;
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
      if (cardDragOverFrameId !== null) {
        window.cancelAnimationFrame(cardDragOverFrameId);
        cardDragOverFrameId = null;
      }
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
      // Check for Cmd+Option+Click (Mac) or Ctrl+Alt+Click (Windows/Linux) to open to the right
      const isNewTab = evt.ctrlKey || evt.metaKey;
      const isOpenToRight = isNewTab && evt.altKey;
      void this.app.workspace.openLinkText(
        filePath,
        "",
        isOpenToRight ? "split" : isNewTab,
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
      const values = getPropertyValues(entry.getValue(propertyId));
      if (values === null) {
        continue;
      }

      const rowEl = propertiesEl.createDiv({
        cls: "bases-kanban-property-row",
      });

      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        const links = parseWikiLinks(value);

        const isTagProperty = propertyId.endsWith(context.tagPropertySuffix);

        if (links.length === 0) {
          // Plain text value
          const cls = isTagProperty
            ? "bases-kanban-property-value bases-kanban-property-tag"
            : "bases-kanban-property-value";
          const valueEl = rowEl.createSpan({
            cls,
            text: value,
          });
          if (isTagProperty) {
            valueEl.style.backgroundColor = getHashColor(
              value,
              context.tagSaturation,
              context.tagLightness,
              context.tagAlpha,
            );
          }
        } else {
          // Has wiki links - render as clickable links
          this.renderWikiLinks(
            rowEl,
            links,
            isTagProperty,
            context.propertyValueSeparator,
            context.tagSaturation,
            context.tagLightness,
            context.tagAlpha,
          );
        }

        // Add separator between values (not after last) - skip for tag properties
        if (!isTagProperty && i < values.length - 1) {
          rowEl.createSpan({
            cls: "bases-kanban-property-separator",
            text: context.propertyValueSeparator,
          });
        }
      }
    }

    if (propertiesEl.childElementCount === 0) {
      propertiesEl.remove();
    }
  }

  private getCardTitle(
    entry: BasesEntry,
    cardTitleSource: "basename" | "filename" | "path",
  ): string {
    switch (cardTitleSource) {
      case "filename":
        return entry.file.name;
      case "path":
        return entry.file.path;
      case "basename":
      default:
        return entry.file.basename;
    }
  }

  private truncateTitle(title: string, maxLength: number): string {
    if (maxLength <= 0 || title.length <= maxLength) {
      return title;
    }
    return title.slice(0, maxLength - 3) + "...";
  }
}
