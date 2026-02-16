import {
  App,
  BasesEntry,
  BasesEntryGroup,
  BasesPropertyId,
  BasesView,
  Menu,
  QueryController,
  TFile,
} from "obsidian";

import {
  CARD_SORT_PROPERTY_OPTION_KEY,
  COLUMN_ORDER_OPTION_KEY,
  DEFAULT_CARD_SORT_PROPERTY_ID,
  GROUP_BY_PLACEHOLDER,
} from "./kanban-view/constants";
import { getKanbanViewOptions } from "./kanban-view/options";
import {
  detectGroupByProperty,
  getColumnKey,
  getPropertyCandidates,
  getSelectedProperties,
  getWritablePropertyKey,
  hasConfiguredGroupBy,
  sortEntriesByRank,
  sortRange,
} from "./kanban-view/utils";
import { buildEntryIndexes, getElementByDataset } from "./kanban-view/indexing";
import { KanbanDragController } from "./kanban-view/drag-controller";
import { KanbanMutationService } from "./kanban-view/mutations";
import {
  KanbanRenderer,
  type KanbanRendererHandlers,
  type RenderContext,
} from "./kanban-view/renderer";

export class KanbanView extends BasesView {
  type = "kanban";
  private readonly rootEl: HTMLElement;
  private readonly dragController: KanbanDragController;
  private readonly mutationService: KanbanMutationService;
  private readonly renderer: KanbanRenderer;
  private selectedPaths = new Set<string>();
  private cardOrder: string[] = [];
  private entryByPath = new Map<string, BasesEntry>();
  private lastSelectedIndex: number | null = null;

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller);
    this.rootEl = containerEl.createDiv({ cls: "bases-kanban-container" });
    this.dragController = new KanbanDragController(this.rootEl);
    this.mutationService = new KanbanMutationService(this.app as App);
    const handlers: KanbanRendererHandlers = {
      onStartColumnDrag: (evt, columnKey) => {
        this.startColumnDrag(evt, columnKey);
      },
      onEndColumnDrag: () => {
        this.endColumnDrag();
      },
      onSetColumnDropIndicator: (columnKey, placement) => {
        this.setColumnDropIndicator(columnKey, placement);
      },
      onClearColumnDropIndicator: () => {
        this.clearColumnDropIndicator();
      },
      onHandleColumnDrop: (columnKey, placement) => {
        this.handleColumnDrop(columnKey, placement);
      },
      onCreateCardForColumn: async (groupByProperty, groupKey) => {
        await this.createCardForColumn(groupByProperty, groupKey);
      },
      onSetupCardDragBehavior: (cardEl) => {
        this.setupCardDragBehavior(cardEl);
      },
      onSelectCard: (filePath, cardIndex, extendSelection) => {
        this.selectCard(filePath, cardIndex, extendSelection);
      },
      onClearSelection: () => {
        this.clearSelection();
      },
      onStartCardDrag: (evt, filePath, cardIndex) => {
        this.startDrag(evt, filePath, cardIndex);
      },
      onEndCardDrag: () => {
        this.endDrag();
      },
      onSetCardDropIndicator: (targetPath, placement) => {
        this.setCardDropIndicator(targetPath, placement);
      },
      onClearCardDropIndicator: () => {
        this.clearCardDropIndicator();
      },
      onHandleDrop: async (
        groupByProperty,
        groupKey,
        targetPath,
        placement,
      ) => {
        await this.handleDrop(groupByProperty, groupKey, targetPath, placement);
      },
      onShowCardContextMenu: (evt, file) => {
        this.showCardContextMenu(evt, file);
      },
    };
    this.renderer = new KanbanRenderer(this.app as App, handlers);
  }

  onDataUpdated(): void {
    this.render();
  }

  private render(): void {
    const previousBoardScrollLeft = this.getBoardScrollLeft();
    this.rootEl.empty();

    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    const groups = this.mergeGroupsByColumnKey(rawGroups);
    if (!hasConfiguredGroupBy(groups)) {
      this.refreshEntryIndexes(groups);
      this.renderPlaceholder();
      return;
    }

    const orderedGroups = this.sortGroupsByColumnOrder(groups);
    const cardSortConfig = this.getWritableCardSortConfig();
    const renderedGroups = orderedGroups.map((group) => ({
      group,
      entries:
        cardSortConfig === null
          ? group.entries
          : sortEntriesByRank(group.entries, cardSortConfig),
    }));
    this.refreshEntryIndexesFromRendered(renderedGroups);

    const selectedProperties = getSelectedProperties(this.data?.properties);
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(selectedProperties, this.allProperties),
    );

    const boardEl = this.rootEl.createDiv({ cls: "bases-kanban-board" });
    const context: RenderContext = {
      selectedProperties,
      groupByProperty,
      selectedPaths: this.selectedPaths,
      getDraggingColumnKey: () => this.dragController.getColumnDragSourceKey(),
      getDraggingSourcePath: () => this.dragController.getCardDragSourcePath(),
      getColumnDropPlacement: () =>
        this.dragController.getColumnDropPlacement(),
      getCardDropPlacement: () => this.dragController.getCardDropPlacement(),
      getCardDropTargetPath: () => this.dragController.getCardDropTargetPath(),
    };

    let cardIndex = 0;
    for (const renderedGroup of renderedGroups) {
      cardIndex = this.renderer.renderColumn(
        boardEl,
        getColumnKey(renderedGroup.group.key),
        renderedGroup.group.key,
        renderedGroup.entries,
        cardIndex,
        context,
      );
    }

    this.restoreBoardScrollLeft(previousBoardScrollLeft);
  }

  private getBoardScrollLeft(): number {
    const boardEl = this.rootEl.querySelector<HTMLElement>(
      ".bases-kanban-board",
    );
    if (boardEl === null) {
      return 0;
    }

    return boardEl.scrollLeft;
  }

  private restoreBoardScrollLeft(scrollLeft: number): void {
    if (scrollLeft <= 0) {
      return;
    }

    const boardEl = this.rootEl.querySelector<HTMLElement>(
      ".bases-kanban-board",
    );
    if (boardEl === null) {
      return;
    }

    boardEl.scrollLeft = scrollLeft;
    window.requestAnimationFrame(() => {
      if (this.rootEl.contains(boardEl)) {
        boardEl.scrollLeft = scrollLeft;
      }
    });
  }

  private renderPlaceholder(): void {
    this.rootEl.createEl("p", {
      text: GROUP_BY_PLACEHOLDER,
      cls: "bases-kanban-placeholder",
    });
  }

  private setupCardDragBehavior(cardEl: HTMLElement): void {
    cardEl.addEventListener("mousedown", (evt) => {
      cardEl.draggable = evt.button === 0;
    });
    cardEl.addEventListener("mouseup", () => {
      if (this.dragController.getCardDragSourcePath() === null) {
        cardEl.draggable = false;
      }
    });
    cardEl.addEventListener("contextmenu", () => {
      if (this.dragController.getCardDragSourcePath() === null) {
        cardEl.draggable = false;
      }
    });
    cardEl.addEventListener("dragend", () => {
      cardEl.draggable = false;
    });
  }

  private showCardContextMenu(evt: MouseEvent, file: TFile): void {
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    const menu = new Menu();
    this.app.workspace.trigger("file-menu", menu, file, "kanban-view");
    menu.showAtPosition({ x: evt.pageX, y: evt.pageY });
  }

  private async createCardForColumn(
    groupByProperty: BasesPropertyId | null,
    groupKey: unknown,
  ): Promise<void> {
    const groupByPropertyKey =
      groupByProperty === null ? null : getWritablePropertyKey(groupByProperty);
    const cardSortConfig = this.getWritableCardSortConfig();
    const newCardRank =
      cardSortConfig === null
        ? null
        : this.mutationService.getNewCardRankForColumn(
            this.data?.groupedData ?? [],
            groupKey,
            cardSortConfig.propertyId,
            cardSortConfig.direction,
          );

    await this.mutationService.createCardForColumn({
      groupByProperty,
      groupByPropertyKey,
      groupKey,
      cardSortConfig,
      newCardRank,
      createFileForView: async (filePath, updateFrontmatter) => {
        await this.createFileForView(filePath, updateFrontmatter);
      },
    });
  }

  private refreshEntryIndexes(groups: BasesEntryGroup[]): void {
    const indexes = buildEntryIndexes(groups);
    this.entryByPath = indexes.entryByPath;
    this.cardOrder = indexes.cardOrder;
    this.selectedPaths = new Set(
      [...this.selectedPaths].filter((path) => this.entryByPath.has(path)),
    );

    if (this.selectedPaths.size === 0) {
      this.lastSelectedIndex = null;
    }
  }

  private refreshEntryIndexesFromRendered(
    renderedGroups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>,
  ): void {
    const indexes = buildEntryIndexes(renderedGroups);
    this.entryByPath = indexes.entryByPath;
    this.cardOrder = indexes.cardOrder;
    this.selectedPaths = new Set(
      [...this.selectedPaths].filter((path) => this.entryByPath.has(path)),
    );

    if (this.selectedPaths.size === 0) {
      this.lastSelectedIndex = null;
    }
  }

  private selectCard(
    filePath: string,
    cardIndex: number,
    extendSelection: boolean,
  ): void {
    if (extendSelection && this.lastSelectedIndex !== null) {
      const [start, end] = sortRange(this.lastSelectedIndex, cardIndex);
      const nextSelection = new Set(this.selectedPaths);
      for (let index = start; index <= end; index += 1) {
        const path = this.cardOrder[index];
        if (path !== undefined) {
          nextSelection.add(path);
        }
      }

      this.selectedPaths = nextSelection;
      this.lastSelectedIndex = cardIndex;
      this.updateSelectionStyles();
      return;
    }

    if (this.selectedPaths.has(filePath)) {
      this.selectedPaths.delete(filePath);
      if (this.selectedPaths.size === 0) {
        this.lastSelectedIndex = null;
      }
    } else {
      this.selectedPaths = new Set([filePath]);
      this.lastSelectedIndex = cardIndex;
    }

    this.updateSelectionStyles();
  }

  private clearSelection(): void {
    if (this.selectedPaths.size === 0) {
      return;
    }

    this.selectedPaths.clear();
    this.lastSelectedIndex = null;
    this.updateSelectionStyles();
  }

  private updateSelectionStyles(): void {
    const cardEls =
      this.rootEl.querySelectorAll<HTMLElement>(".bases-kanban-card");

    cardEls.forEach((cardEl) => {
      const path = cardEl.dataset.cardPath;
      cardEl.toggleClass(
        "bases-kanban-card-selected",
        path !== undefined && this.selectedPaths.has(path),
      );
    });
  }

  private startDrag(evt: DragEvent, filePath: string, cardIndex: number): void {
    if (!this.selectedPaths.has(filePath)) {
      this.selectedPaths = new Set([filePath]);
      this.lastSelectedIndex = cardIndex;
      this.updateSelectionStyles();
    }

    this.dragController.startCardDrag(evt, filePath);

    const dragPaths = this.getDraggedPaths(filePath);
    for (const path of dragPaths) {
      const cardEl = this.getCardEl(path);
      cardEl?.addClass("bases-kanban-card-dragging");
    }
  }

  private endDrag(): void {
    this.dragController.endCardDrag();
  }

  private setCardDropIndicator(
    targetPath: string,
    placement: "before" | "after",
  ): void {
    this.dragController.setCardDropIndicator(targetPath, placement, (path) =>
      this.getCardEl(path),
    );
  }

  private clearCardDropIndicator(): void {
    this.dragController.clearCardDropIndicator();
  }

  private startColumnDrag(evt: DragEvent, columnKey: string): void {
    this.dragController.startColumnDrag(evt, columnKey);
  }

  private endColumnDrag(): void {
    this.dragController.endColumnDrag();
  }

  private setColumnDropIndicator(
    columnKey: string,
    placement: "before" | "after",
  ): void {
    this.dragController.setColumnDropIndicator(columnKey, placement, (key) =>
      this.getColumnEl(key),
    );
  }

  private clearColumnDropIndicator(): void {
    this.dragController.clearColumnDropIndicator();
  }

  private getColumnEl(columnKey: string): HTMLElement | null {
    return getElementByDataset(
      this.rootEl,
      ".bases-kanban-column",
      "columnKey",
      columnKey,
    );
  }

  private handleColumnDrop(
    targetColumnKey: string,
    placement: "before" | "after",
  ): void {
    const sourceColumnKey = this.dragController.getColumnDragSourceKey();
    this.endColumnDrag();
    if (sourceColumnKey === null || sourceColumnKey === targetColumnKey) {
      return;
    }

    const orderedGroups = this.sortGroupsByColumnOrder(
      this.mergeGroupsByColumnKey(this.data?.groupedData ?? []),
    );
    const orderedKeys = orderedGroups.map((group) => getColumnKey(group.key));
    const sourceIndex = orderedKeys.indexOf(sourceColumnKey);
    const targetIndex = orderedKeys.indexOf(targetColumnKey);
    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    const [moved] = orderedKeys.splice(sourceIndex, 1);
    let insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }
    orderedKeys.splice(insertionIndex, 0, moved);
    this.updateColumnOrder(orderedKeys);
    this.render();
  }

  private sortGroupsByColumnOrder(
    groups: BasesEntryGroup[],
  ): BasesEntryGroup[] {
    const columnOrder = this.getColumnOrderFromConfig();
    if (columnOrder.length === 0) {
      return groups;
    }

    const orderMap = new Map(
      columnOrder.map((columnKey, index) => [columnKey, index]),
    );
    return [...groups].sort((groupA, groupB) => {
      const indexA =
        orderMap.get(getColumnKey(groupA.key)) ?? Number.POSITIVE_INFINITY;
      const indexB =
        orderMap.get(getColumnKey(groupB.key)) ?? Number.POSITIVE_INFINITY;
      if (
        indexA === Number.POSITIVE_INFINITY &&
        indexB === Number.POSITIVE_INFINITY
      ) {
        return 0;
      }

      return indexA - indexB;
    });
  }

  private mergeGroupsByColumnKey(
    groups: BasesEntryGroup[],
  ): BasesEntryGroup[] {
    const mergedByColumnKey = new Map<string, BasesEntryGroup>();

    for (const group of groups) {
      const columnKey = getColumnKey(group.key);
      const existing = mergedByColumnKey.get(columnKey);
      if (existing === undefined) {
        mergedByColumnKey.set(columnKey, {
          key: group.key,
          hasKey: group.hasKey,
          entries: [...group.entries],
        });
        continue;
      }

      existing.hasKey = existing.hasKey || group.hasKey;
      existing.entries.push(...group.entries);
    }

    return [...mergedByColumnKey.values()];
  }

  private getColumnOrderFromConfig(): string[] {
    const configValue = this.config?.get(COLUMN_ORDER_OPTION_KEY);
    if (typeof configValue !== "string" || configValue.trim().length === 0) {
      return [];
    }

    return configValue
      .split(",")
      .map((columnKey) => columnKey.trim())
      .filter((columnKey) => columnKey.length > 0);
  }

  private updateColumnOrder(columnOrder: string[]): void {
    this.config?.set(COLUMN_ORDER_OPTION_KEY, columnOrder.join(","));
  }

  private getDraggedPaths(sourcePath: string): string[] {
    if (!this.selectedPaths.has(sourcePath)) {
      return [sourcePath];
    }

    return this.cardOrder.filter((path) => this.selectedPaths.has(path));
  }

  private getCardEl(path: string): HTMLElement | null {
    return getElementByDataset(
      this.rootEl,
      ".bases-kanban-card",
      "cardPath",
      path,
    );
  }

  private async handleDrop(
    groupByProperty: BasesPropertyId | null,
    groupKey: unknown,
    targetPath: string | null,
    placement: "before" | "after",
  ): Promise<void> {
    const draggingSourcePath = this.dragController.getCardDragSourcePath();
    if (groupByProperty === null || draggingSourcePath === null) {
      return;
    }

    await this.mutationService.handleDrop({
      groupByProperty,
      groupByPropertyKey: getWritablePropertyKey(groupByProperty),
      groupKey,
      targetPath,
      placement,
      draggingSourcePath,
      draggedPaths: this.getDraggedPaths(draggingSourcePath),
      entryByPath: this.entryByPath,
      getColumnCardPaths: (columnKey) => this.getColumnCardPaths(columnKey),
      getColumnKey,
      sortConfig: this.getWritableCardSortConfig(),
    });
  }

  private getWritableCardSortConfig(): {
    propertyId: BasesPropertyId;
    propertyKey: string;
    direction: "ASC" | "DESC";
  } | null {
    const sortConfigs = this.config?.getSort() ?? [];
    for (const sortConfig of sortConfigs) {
      const propertyKey = getWritablePropertyKey(sortConfig.property);
      if (propertyKey === null) {
        continue;
      }

      return {
        propertyId: sortConfig.property,
        propertyKey,
        direction: sortConfig.direction,
      };
    }

    const fallbackPropertyId = this.config?.getAsPropertyId(
      CARD_SORT_PROPERTY_OPTION_KEY,
    );
    const resolvedFallbackPropertyId =
      fallbackPropertyId ?? DEFAULT_CARD_SORT_PROPERTY_ID;
    const fallbackPropertyKey = getWritablePropertyKey(
      resolvedFallbackPropertyId,
    );
    if (fallbackPropertyKey === null) {
      return null;
    }

    return {
      propertyId: resolvedFallbackPropertyId,
      propertyKey: fallbackPropertyKey,
      direction: "ASC",
    };
  }

  private getColumnCardPaths(columnKey: string): string[] {
    const columnEl = this.getColumnEl(columnKey);
    if (columnEl === null) {
      return [];
    }

    const cards = columnEl.querySelectorAll<HTMLElement>(".bases-kanban-card");
    const paths: string[] = [];
    cards.forEach((cardEl) => {
      const path = cardEl.dataset.cardPath;
      if (typeof path === "string" && path.length > 0) {
        paths.push(path);
      }
    });

    return paths;
  }

  static getViewOptions() {
    return getKanbanViewOptions();
  }
}
