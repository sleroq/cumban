import {
  App,
  BasesEntry,
  BasesEntryGroup,
  BasesPropertyId,
  BasesView,
  Menu,
  Modal,
  normalizePath,
  Notice,
  QueryController,
  TFile,
} from "obsidian";

import type BasesKanbanPlugin from "./main";
import {
  BACKGROUND_BLUR_OPTION_KEY,
  BACKGROUND_BRIGHTNESS_OPTION_KEY,
  BACKGROUND_IMAGE_OPTION_KEY,
  BOARD_SCROLL_POSITION_KEY,
  COLUMN_ORDER_OPTION_KEY,
  COLUMN_TRANSPARENCY_OPTION_KEY,
  LOCAL_CARD_ORDER_OPTION_KEY,
} from "./kanban-view/constants";
import { getKanbanViewOptions } from "./kanban-view/options";
import {
  detectGroupByProperty,
  getColumnKey,
  getPropertyCandidates,
  getSelectedProperties,
  getWritablePropertyKey,
  hasConfiguredGroupBy,
  sortRange,
} from "./kanban-view/utils";
import { buildEntryIndexes } from "./kanban-view/indexing";
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
  private readonly plugin: BasesKanbanPlugin;
  private selectedPaths = new Set<string>();
  private cardOrder: string[] = [];
  private entryByPath = new Map<string, BasesEntry>();
  private lastSelectedIndex: number | null = null;
  private scrollSaveTimeout: number | null = null;
  private bgEl: HTMLElement | null = null;
  private cachedImageUrl: string | null = null;
  private cachedBackgroundInput: string | null = null;
  private cachedResolvedImageUrl: string | null = null;
  private cachedBackgroundFilter: string | null = null;
  private cachedColumnTransparencyValue: number | null = null;
  private backgroundImageLoadVersion = 0;
  private cardElByPath = new Map<string, HTMLElement>();
  private columnElByKey = new Map<string, HTMLElement>();

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    plugin: BasesKanbanPlugin,
  ) {
    super(controller);
    this.plugin = plugin;
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
      onKeyDown: (evt) => {
        this.handleKeyDown(evt);
      },
      onColumnScroll: (columnKey, scrollTop) => {
        this.handleColumnScroll(columnKey, scrollTop);
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
    this.applyBackgroundStyles();

    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    const groups = this.mergeGroupsByColumnKey(rawGroups);
    if (!hasConfiguredGroupBy(groups)) {
      this.refreshEntryIndexes(groups);
      this.clearElementIndexes();
      this.renderPlaceholder();
      return;
    }

    const orderedGroups = this.sortGroupsByColumnOrder(groups);
    const localCardOrderByColumn = this.getLocalCardOrderByColumn();
    const renderedGroups = orderedGroups.map((group) => ({
      group,
      entries: this.applyLocalCardOrder(
        getColumnKey(group.key),
        group.entries,
        localCardOrderByColumn,
      ),
    }));
    this.refreshEntryIndexesFromRendered(renderedGroups);

    const selectedProperties = getSelectedProperties(this.data?.properties);
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(selectedProperties, this.allProperties),
    );

    const boardEl = this.rootEl.createDiv({ cls: "bases-kanban-board" });
    this.setupBoardScrollListener(boardEl);
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
      emptyColumnLabel: this.plugin.settings.emptyColumnLabel,
      addCardButtonText: this.plugin.settings.addCardButtonText,
      cardTitleSource: this.plugin.settings.cardTitleSource,
      cardTitleMaxLength: this.plugin.settings.cardTitleMaxLength,
      propertyValueSeparator: this.plugin.settings.propertyValueSeparator,
      tagPropertySuffix: this.plugin.settings.tagPropertySuffix,
      tagSaturation: this.plugin.settings.tagSaturation,
      tagLightness: this.plugin.settings.tagLightness,
      tagAlpha: this.plugin.settings.tagAlpha,
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

    this.refreshElementIndexes();

    const scrollLeftToRestore =
      previousBoardScrollLeft > 0
        ? previousBoardScrollLeft
        : this.loadBoardScrollPosition();
    this.restoreBoardScrollLeft(scrollLeftToRestore);
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

  private setupBoardScrollListener(boardEl: HTMLElement): void {
    boardEl.addEventListener("scroll", () => {
      this.debouncedSaveBoardScrollPosition(boardEl.scrollLeft);
    });
  }

  private debouncedSaveBoardScrollPosition(scrollLeft: number): void {
    if (this.scrollSaveTimeout !== null) {
      window.clearTimeout(this.scrollSaveTimeout);
    }
    this.scrollSaveTimeout = window.setTimeout(() => {
      this.saveBoardScrollPosition(scrollLeft);
      this.scrollSaveTimeout = null;
    }, this.plugin.settings.scrollDebounceMs);
  }

  private saveBoardScrollPosition(scrollLeft: number): void {
    this.config?.set(BOARD_SCROLL_POSITION_KEY, String(scrollLeft));
  }

  private loadBoardScrollPosition(): number {
    const configValue = this.config?.get(BOARD_SCROLL_POSITION_KEY);
    if (typeof configValue !== "string" || configValue.length === 0) {
      return 0;
    }
    const parsed = Number.parseInt(configValue, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private renderPlaceholder(): void {
    this.applyBackgroundStyles();
    this.rootEl.createEl("p", {
      text: this.plugin.settings.placeholderText,
      cls: "bases-kanban-placeholder",
    });
  }

  private resolveBackgroundInput(input: string): string | null {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return null;
    }

    // Check if it's a URL (http:// or https://)
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    // Treat as vault file path
    const normalizedPath = normalizePath(trimmed);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file instanceof TFile) {
      return this.app.vault.getResourcePath(file);
    }

    return null;
  }

  private getConfigNumber(
    key: string,
    globalDefault: number,
    min: number,
    max: number,
  ): number {
    const rawValue = this.config?.get(key);
    if (typeof rawValue === "number" && !Number.isNaN(rawValue)) {
      return Math.max(min, Math.min(max, rawValue));
    }
    return globalDefault;
  }

  private applyBackgroundStyles(): void {
    const imageUrl = this.resolveBackgroundImageUrl(
      this.config?.get(BACKGROUND_IMAGE_OPTION_KEY),
    );

    // Get configuration values
    const brightness = this.getConfigNumber(
      BACKGROUND_BRIGHTNESS_OPTION_KEY,
      this.plugin.settings.backgroundBrightness,
      0,
      100,
    );
    const blur = this.getConfigNumber(
      BACKGROUND_BLUR_OPTION_KEY,
      this.plugin.settings.backgroundBlur,
      0,
      20,
    );
    const columnTransparency = this.getConfigNumber(
      COLUMN_TRANSPARENCY_OPTION_KEY,
      this.plugin.settings.columnTransparency,
      0,
      100,
    );

    // Apply column transparency CSS variable
    const columnTransparencyValue = columnTransparency / 100;
    if (this.cachedColumnTransparencyValue !== columnTransparencyValue) {
      this.rootEl.style.setProperty(
        "--bases-kanban-column-transparency",
        String(columnTransparencyValue),
      );
      this.cachedColumnTransparencyValue = columnTransparencyValue;
    }

    // Manage background element
    if (imageUrl !== null) {
      const urlChanged = imageUrl !== this.cachedImageUrl;
      let createdBackgroundElement = false;

      if (this.bgEl === null || !this.rootEl.contains(this.bgEl)) {
        this.bgEl = this.rootEl.createDiv({ cls: "bases-kanban-background" });
        createdBackgroundElement = true;
      }

      if (this.bgEl === null) {
        return;
      }

      if (createdBackgroundElement && this.cachedImageUrl !== null) {
        this.bgEl.style.backgroundImage = `url("${this.cachedImageUrl}")`;
      }

      if (urlChanged) {
        this.preloadBackgroundImage(imageUrl);
      } else if (createdBackgroundElement) {
        this.bgEl.style.backgroundImage = `url("${imageUrl}")`;
      }

      const nextFilter = `blur(${blur}px) brightness(${brightness}%)`;
      if (createdBackgroundElement || this.cachedBackgroundFilter !== nextFilter) {
        this.bgEl.style.filter = nextFilter;
        this.cachedBackgroundFilter = nextFilter;
      }
      return;
    }

    this.backgroundImageLoadVersion += 1;
    if (this.bgEl !== null) {
      this.bgEl.remove();
      this.bgEl = null;
    }
    this.cachedImageUrl = null;
    this.cachedBackgroundFilter = null;
  }

  private resolveBackgroundImageUrl(rawInput: unknown): string | null {
    if (typeof rawInput !== "string") {
      this.cachedBackgroundInput = null;
      this.cachedResolvedImageUrl = null;
      return null;
    }

    if (rawInput === this.cachedBackgroundInput) {
      return this.cachedResolvedImageUrl;
    }

    const resolvedImageUrl = this.resolveBackgroundInput(rawInput);
    this.cachedBackgroundInput = rawInput;
    this.cachedResolvedImageUrl = resolvedImageUrl;
    return resolvedImageUrl;
  }

  private preloadBackgroundImage(imageUrl: string): void {
    const currentVersion = this.backgroundImageLoadVersion + 1;
    this.backgroundImageLoadVersion = currentVersion;
    const image = new Image();
    image.onload = () => {
      if (currentVersion !== this.backgroundImageLoadVersion) {
        return;
      }

      if (this.bgEl === null || !this.rootEl.contains(this.bgEl)) {
        return;
      }

      this.bgEl.style.backgroundImage = `url("${imageUrl}")`;
      this.cachedImageUrl = imageUrl;
    };
    image.onerror = () => {
      if (currentVersion !== this.backgroundImageLoadVersion) {
        return;
      }

      console.error(`Failed to load background image: ${imageUrl}`);
    };
    image.src = imageUrl;
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

    // Add custom trash option at the top
    menu.addItem((item) => {
      item
        .setTitle(this.plugin.settings.trashMenuText)
        .setIcon("trash")
        .onClick(() => void this.trashFiles([file]));
    });

    menu.addSeparator();

    this.app.workspace.trigger("file-menu", menu, file, "kanban-view");
    menu.showAtMouseEvent(evt);
  }

  private async trashFiles(files: TFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    // Show confirmation for multiple files
    if (files.length > 1) {
      const confirmed = await new Promise<boolean>((resolve) => {
        const modal = new Modal(this.app as App);
        modal.titleEl.setText(
          `Move ${files.length} files to trash?`,
        );
        modal.contentEl.createEl("p", {
          text: `This will move ${files.length} files to the trash. This action can be undone from the system trash.`,
        });

        const buttonContainer = modal.contentEl.createDiv({
          cls: "modal-button-container",
        });

        const cancelButton = buttonContainer.createEl("button", {
          text: this.plugin.settings.cancelButtonText,
          cls: "mod-secondary",
        });
        cancelButton.addEventListener("click", () => {
          resolve(false);
          modal.close();
        });

        const confirmButton = buttonContainer.createEl("button", {
          text: this.plugin.settings.trashConfirmButtonText,
          cls: "mod-cta",
        });
        confirmButton.style.backgroundColor = "var(--background-modifier-error)";
        confirmButton.style.color = "var(--text-on-accent)";
        confirmButton.addEventListener("click", () => {
          resolve(true);
          modal.close();
        });

        modal.open();
      });

      if (!confirmed) {
        return;
      }
    }

    // Trash files - try system trash first, fall back to local trash
    const trashedFiles: string[] = [];
    const failedFiles: string[] = [];

    const promises = files.map(async (file) => {
      try {
        await this.app.vault.trash(file, true);
        trashedFiles.push(file.path);
      } catch (error) {
        console.error(`Failed to trash ${file.path}:`, error);
        failedFiles.push(file.path);
      }
    });

    await Promise.all(promises);

    // Show notice if some files failed
    if (failedFiles.length > 0) {
      const noticeText = this.plugin.settings.failedTrashNoticeText.replace(
        "{count}",
        String(failedFiles.length),
      );
      new Notice(noticeText);
    }

    this.clearSelection();
  }

  private handleKeyDown(evt: KeyboardEvent): void {
    // Cmd/Ctrl + configured shortcut key to trash selected files
    const shortcutKey = this.plugin.settings.trashShortcutKey;
    if ((evt.metaKey || evt.ctrlKey) && evt.key === shortcutKey) {
      if (this.selectedPaths.size === 0) {
        return;
      }

      evt.preventDefault();
      evt.stopPropagation();

      // Get TFile objects from selected paths
      const filesToTrash: TFile[] = [];
      for (const path of this.selectedPaths) {
        const entry = this.entryByPath.get(path);
        if (entry?.file) {
          filesToTrash.push(entry.file);
        }
      }

      if (filesToTrash.length > 0) {
        void this.trashFiles(filesToTrash);
      }
    }
  }

  private async createCardForColumn(
    groupByProperty: BasesPropertyId | null,
    groupKey: unknown,
  ): Promise<void> {
    const groupByPropertyKey =
      groupByProperty === null ? null : getWritablePropertyKey(groupByProperty);

    await this.mutationService.createCardForColumn({
      groupByProperty,
      groupByPropertyKey,
      groupKey,
      createFileForView: async (filePath, updateFrontmatter) => {
        await this.createFileForView(filePath, updateFrontmatter);
      },
    });
  }

  private applyLocalCardOrder(
    columnKey: string,
    entries: BasesEntry[],
    localOrderByColumn: Map<string, string[]>,
  ): BasesEntry[] {
    const orderedPaths = localOrderByColumn.get(columnKey);
    if (orderedPaths === undefined || orderedPaths.length === 0) {
      return entries;
    }

    const entryByPath = new Map(
      entries.map((entry) => [entry.file.path, entry]),
    );
    const nextEntries: BasesEntry[] = [];
    const usedPaths = new Set<string>();

    for (const path of orderedPaths) {
      const entry = entryByPath.get(path);
      if (entry === undefined) {
        continue;
      }

      nextEntries.push(entry);
      usedPaths.add(path);
    }

    const newEntries: BasesEntry[] = [];
    for (const entry of entries) {
      if (usedPaths.has(entry.file.path)) {
        continue;
      }

      newEntries.push(entry);
    }

    nextEntries.unshift(...newEntries);

    return nextEntries;
  }

  private getLocalCardOrderByColumn(): Map<string, string[]> {
    const configValue = this.config?.get(LOCAL_CARD_ORDER_OPTION_KEY);
    if (typeof configValue !== "string" || configValue.trim().length === 0) {
      return new Map();
    }

    try {
      const parsedValue = JSON.parse(configValue) as unknown;
      if (parsedValue === null || typeof parsedValue !== "object") {
        return new Map();
      }

      const orderByColumn = new Map<string, string[]>();
      for (const [columnKey, pathsValue] of Object.entries(parsedValue)) {
        if (!Array.isArray(pathsValue) || columnKey.trim().length === 0) {
          continue;
        }

        const paths: string[] = [];
        const seenPaths = new Set<string>();
        for (const pathValue of pathsValue) {
          if (typeof pathValue !== "string" || pathValue.length === 0) {
            continue;
          }

          if (seenPaths.has(pathValue)) {
            continue;
          }

          seenPaths.add(pathValue);
          paths.push(pathValue);
        }

        if (paths.length > 0) {
          orderByColumn.set(columnKey, paths);
        }
      }

      return orderByColumn;
    } catch {
      return new Map();
    }
  }

  private setLocalCardOrderByColumn(
    orderByColumn: Map<string, string[]>,
  ): void {
    if (orderByColumn.size === 0) {
      this.config?.set(LOCAL_CARD_ORDER_OPTION_KEY, "");
      return;
    }

    const serialized: Record<string, string[]> = {};
    for (const [columnKey, paths] of orderByColumn.entries()) {
      if (paths.length === 0) {
        continue;
      }

      serialized[columnKey] = paths;
    }

    const nextConfigValue =
      Object.keys(serialized).length === 0 ? "" : JSON.stringify(serialized);
    this.config?.set(LOCAL_CARD_ORDER_OPTION_KEY, nextConfigValue);
  }

  private updateLocalCardOrderForDrop(
    sourceColumnKey: string | null,
    targetColumnKey: string,
    draggedPaths: string[],
    targetPath: string | null,
    placement: "before" | "after",
  ): void {
    if (draggedPaths.length === 0) {
      return;
    }

    const uniqueDraggedPaths: string[] = [];
    const movedSet = new Set<string>();
    for (const path of draggedPaths) {
      if (movedSet.has(path)) {
        continue;
      }

      movedSet.add(path);
      uniqueDraggedPaths.push(path);
    }

    const localOrderByColumn = this.getLocalCardOrderByColumn();
    if (sourceColumnKey === null || sourceColumnKey === targetColumnKey) {
      const currentPaths = this.getColumnCardPaths(targetColumnKey);
      const reorderedPaths = this.reorderPathsForDrop(
        currentPaths,
        uniqueDraggedPaths,
        targetPath,
        placement,
      );
      localOrderByColumn.set(targetColumnKey, reorderedPaths);
      this.setLocalCardOrderByColumn(localOrderByColumn);
      return;
    }

    const sourcePaths = this.getColumnCardPaths(sourceColumnKey).filter(
      (path) => !movedSet.has(path),
    );
    const targetPaths = this.getColumnCardPaths(targetColumnKey).filter(
      (path) => !movedSet.has(path),
    );
    const reorderedTargetPaths = this.reorderPathsForDrop(
      targetPaths,
      uniqueDraggedPaths,
      targetPath,
      placement,
    );

    localOrderByColumn.set(sourceColumnKey, sourcePaths);
    localOrderByColumn.set(targetColumnKey, reorderedTargetPaths);
    this.setLocalCardOrderByColumn(localOrderByColumn);
  }

  private reorderPathsForDrop(
    existingPaths: string[],
    movedPaths: string[],
    targetPath: string | null,
    placement: "before" | "after",
  ): string[] {
    const movedSet = new Set(movedPaths);
    if (targetPath !== null && movedSet.has(targetPath)) {
      return existingPaths;
    }

    const nextPaths = existingPaths.filter((path) => !movedSet.has(path));
    let insertionIndex = nextPaths.length;

    if (targetPath !== null) {
      const targetIndex = nextPaths.indexOf(targetPath);
      if (targetIndex !== -1) {
        insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
      }
    }

    nextPaths.splice(insertionIndex, 0, ...movedPaths);
    return nextPaths;
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
    return this.columnElByKey.get(columnKey) ?? null;
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

  private handleColumnScroll(columnKey: string, scrollTop: number): void {
    // Stub for vertical column scroll - not currently implemented
    // This satisfies the KanbanRendererHandlers interface
    void columnKey;
    void scrollTop;
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

  private mergeGroupsByColumnKey(groups: BasesEntryGroup[]): BasesEntryGroup[] {
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
    return this.cardElByPath.get(path) ?? null;
  }

  private clearElementIndexes(): void {
    this.cardElByPath.clear();
    this.columnElByKey.clear();
  }

  private refreshElementIndexes(): void {
    this.clearElementIndexes();

    const columnEls = this.rootEl.querySelectorAll<HTMLElement>(
      ".bases-kanban-column",
    );
    columnEls.forEach((columnEl) => {
      const columnKey = columnEl.dataset.columnKey;
      if (typeof columnKey === "string" && columnKey.length > 0) {
        this.columnElByKey.set(columnKey, columnEl);
      }
    });

    const cardEls = this.rootEl.querySelectorAll<HTMLElement>(
      ".bases-kanban-card",
    );
    cardEls.forEach((cardEl) => {
      const path = cardEl.dataset.cardPath;
      if (typeof path === "string" && path.length > 0) {
        this.cardElByPath.set(path, cardEl);
      }
    });
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

    const draggedPaths = this.getDraggedPaths(draggingSourcePath);
    const sourceEntry = this.entryByPath.get(draggingSourcePath);
    const sourceColumnKey =
      sourceEntry === undefined
        ? null
        : getColumnKey(sourceEntry.getValue(groupByProperty));
    const targetColumnKey = getColumnKey(groupKey);

    this.updateLocalCardOrderForDrop(
      sourceColumnKey,
      targetColumnKey,
      draggedPaths,
      targetPath,
      placement,
    );

    await this.mutationService.handleDrop({
      groupByProperty,
      groupByPropertyKey: getWritablePropertyKey(groupByProperty),
      groupKey,
      targetPath,
      placement,
      draggingSourcePath,
      draggedPaths,
      entryByPath: this.entryByPath,
      getColumnKey,
    });

    if (sourceColumnKey === targetColumnKey) {
      this.render();
    }
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
