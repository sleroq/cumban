import {
  App,
  BasesEntry,
  BasesEntryGroup,
  type BasesPropertyId,
  BasesView,
  Menu,
  Modal,
  Notice,
  QueryController,
  TFile,
} from "obsidian";
import { mount, unmount } from "svelte";

import type BasesKanbanPlugin from "./main";
import {
  logDebug,
  logDragEvent,
  logRenderEvent,
  logScrollEvent,
} from "./kanban-view/debug";
import {
  BACKGROUND_BLUR_OPTION_KEY,
  BACKGROUND_BRIGHTNESS_OPTION_KEY,
  BACKGROUND_IMAGE_OPTION_KEY,
  BOARD_SCROLL_STATE_KEY,
  COLUMN_BLUR_OPTION_KEY,
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
} from "./kanban-view/utils";
import { buildEntryIndexes } from "./kanban-view/indexing";
import { KanbanMutationService } from "./kanban-view/mutations";
import {
  type ColumnOrderCache,
  type CardOrderCache,
  saveBoardScrollState,
  loadScrollState,
  parseColumnOrder,
  serializeColumnOrder,
  parseLocalCardOrder,
  serializeLocalCardOrder,
  saveColumnScrollPosition,
} from "./kanban-view/state-persistence";
import {
  type BackgroundManagerState,
  applyBackground,
  createBackgroundManagerState,
} from "./kanban-view/background-manager";
import {
  type RenderedGroup,
  type PartialRenderResult,
  mergeGroupsByColumnKey,
  sortGroupsByColumnOrder,
  buildRenderedGroups,
  computeRenderSignature,
  canSkipFullRender,
  computeColumnSnapshots,
  canRenderPartially,
} from "./kanban-view/render-pipeline";
import {
  type SelectionState,
  createSelectionState,
  selectCard as selectCardState,
  clearSelection as clearSelectionState,
  getDraggedPaths as getDraggedPathsState,
  syncSelectionWithEntries,
  isPathSelected,
  hasSelection,
} from "./kanban-view/selection-state";
import KanbanRoot from "./components/KanbanRoot.svelte";

export class KanbanView extends BasesView {
  type = "kanban";
  private readonly rootEl: HTMLElement;
  private readonly mutationService: KanbanMutationService;
  private readonly plugin: BasesKanbanPlugin;
  private selectionState: SelectionState;
  private cardOrder: string[] = [];
  private entryByPath = new Map<string, BasesEntry>();
  private scrollSaveTimeout: number | null = null;
  private backgroundManagerState: BackgroundManagerState;
  private viewSessionId: string;
  private scrollRevision = 0;
  private pendingLocalScrollRevision: number | null = null;
  private hasRenderedBoard = false;
  private lastPersistedScrollState: { left: number; top: number } | null = null;
  private lastRenderSignature: string | null = null;
  private localCardOrderCache: CardOrderCache = { order: null, raw: "" };
  private columnOrderCache: ColumnOrderCache = { order: null, raw: "" };
  private lastColumnPathSnapshots = new Map<string, string[]>();
  private partialRenderCount = 0;
  private static readonly PARTIAL_RENDER_REBUILD_THRESHOLD = 10;
  private svelteApp: ReturnType<typeof KanbanRoot> | null = null;

  // Drag state (replaces drag-controller)
  private draggingCardSourcePath: string | null = null;
  private draggingColumnSourceKey: string | null = null;

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    plugin: BasesKanbanPlugin,
  ) {
    super(controller);
    this.plugin = plugin;
    this.viewSessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.backgroundManagerState = createBackgroundManagerState();
    this.selectionState = createSelectionState();
    this.rootEl = containerEl.createDiv({ cls: "bases-kanban-container" });
    this.mutationService = new KanbanMutationService(this.app as App);
  }

  onDataUpdated(): void {
    if (this.shouldSkipRenderForOwnScrollUpdate()) {
      logRenderEvent("SKIPPED render - own scroll update detected");
      return;
    }
    this.render();
  }

  private shouldSkipRenderForOwnScrollUpdate(): boolean {
    if (this.pendingLocalScrollRevision === null) {
      return false;
    }

    const scrollState = loadScrollState(
      (key) => this.config?.get(key),
      BOARD_SCROLL_STATE_KEY,
    );
    if (
      scrollState !== null &&
      scrollState.sessionId === this.viewSessionId &&
      scrollState.revision === this.pendingLocalScrollRevision
    ) {
      logScrollEvent("Confirmed own scroll revision match", {
        revision: this.pendingLocalScrollRevision,
        sessionId: this.viewSessionId.slice(0, 8) + "...",
      });
      this.pendingLocalScrollRevision = null;
      return true;
    }

    return false;
  }

  private renderPartial(
    renderedGroups: RenderedGroup[],
    changedColumnKeys: string[],
  ): void {
    logRenderEvent("PARTIAL RENDER - replacing columns", {
      changedCount: changedColumnKeys.length,
      changedKeys: changedColumnKeys.join(","),
    });

    // For Svelte, we re-render the whole component but the framework handles
    // efficient updates. In future, could optimize to only update changed props.
    this.renderFull(renderedGroups);

    this.partialRenderCount += 1;
    if (this.partialRenderCount >= KanbanView.PARTIAL_RENDER_REBUILD_THRESHOLD) {
      logRenderEvent("PARTIAL RENDER - rebuilding all indexes (threshold reached)");
      this.partialRenderCount = 0;
    }

    logRenderEvent("PARTIAL RENDER COMPLETE", {
      replacedColumns: changedColumnKeys.length,
      indexRebuild: this.partialRenderCount === 0,
    });
  }

  private render(): void {
    logRenderEvent("render() called");

    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    const groups = mergeGroupsByColumnKey(rawGroups);

    logRenderEvent("Data prepared", {
      rawGroupCount: rawGroups.length,
      mergedGroupCount: groups.length,
      totalEntries: groups.reduce((sum, g) => sum + g.entries.length, 0),
    });

    const displaySettings = {
      cardTitleSource: this.plugin.settings.cardTitleSource,
      cardTitleMaxLength: this.plugin.settings.cardTitleMaxLength,
      propertyValueSeparator: this.plugin.settings.propertyValueSeparator,
      tagPropertySuffix: this.plugin.settings.tagPropertySuffix,
      tagSaturation: this.plugin.settings.tagSaturation,
      tagLightness: this.plugin.settings.tagLightness,
      tagAlpha: this.plugin.settings.tagAlpha,
    };

    const localCardOrderByColumn = this.getLocalCardOrderByColumn();

    const selectedProperties = getSelectedProperties(this.data?.properties);
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(selectedProperties, this.allProperties),
    );

    const currentSignature = computeRenderSignature(
      groups,
      displaySettings,
      localCardOrderByColumn,
      selectedProperties,
      groupByProperty,
    );

    if (canSkipFullRender(currentSignature, this.lastRenderSignature, this.hasRenderedBoard)) {
      logRenderEvent("SKIPPED - full render not needed, updating cheap UI only");
      this.updateCheapUI();
      return;
    }

    if (!hasConfiguredGroupBy(groups)) {
      logRenderEvent("Proceeding with FULL DOM RENDER (no group by)");
      this.rootEl.empty();
      this.applyBackgroundStyles();
      this.refreshEntryIndexes(groups);
      this.renderPlaceholder();
      return;
    }

    const columnOrder = this.getColumnOrderFromConfig();
    const orderedGroups = sortGroupsByColumnOrder(groups, columnOrder);
    const renderedGroups = buildRenderedGroups(orderedGroups, localCardOrderByColumn);

    const { canPartial, changedColumns }: PartialRenderResult = canRenderPartially(
      renderedGroups,
      this.lastColumnPathSnapshots,
      this.hasRenderedBoard,
    );

    if (canPartial && changedColumns.length > 0) {
      this.renderPartial(renderedGroups, changedColumns);
      this.lastRenderSignature = computeRenderSignature(
        groups,
        displaySettings,
        localCardOrderByColumn,
        selectedProperties,
        groupByProperty,
      );
      return;
    }

    logRenderEvent("Proceeding with FULL DOM RENDER", {
      groupCount: groups.length,
      hasConfiguredGroupBy: hasConfiguredGroupBy(groups),
    });

    this.renderFull(renderedGroups);
    this.hasRenderedBoard = true;
    this.lastRenderSignature = computeRenderSignature(
      groups,
      displaySettings,
      localCardOrderByColumn,
      selectedProperties,
      groupByProperty,
    );
    this.lastColumnPathSnapshots = computeColumnSnapshots(renderedGroups);
    this.partialRenderCount = 0;

    logRenderEvent("FULL RENDER COMPLETE");
  }

  private renderFull(renderedGroups: RenderedGroup[]): void {
    this.refreshEntryIndexesFromRendered(renderedGroups);

    const selectedProperties = getSelectedProperties(this.data?.properties);
    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(selectedProperties, this.allProperties),
    );

    // Unmount existing Svelte app if present
    if (this.svelteApp !== null) {
      unmount(this.svelteApp);
      this.svelteApp = null;
    }

    this.rootEl.empty();

    // Mount new Svelte app
    this.svelteApp = mount(KanbanRoot, {
      target: this.rootEl,
      props: {
        app: this.app as App,
        rootEl: this.rootEl,
        groups: renderedGroups,
        groupByProperty,
        selectedProperties,
        selectedPaths: this.selectionState.selectedPaths,
        cardTitleSource: this.plugin.settings.cardTitleSource,
        cardTitleMaxLength: this.plugin.settings.cardTitleMaxLength,
        propertyValueSeparator: this.plugin.settings.propertyValueSeparator,
        tagPropertySuffix: this.plugin.settings.tagPropertySuffix,
        tagSaturation: this.plugin.settings.tagSaturation,
        tagLightness: this.plugin.settings.tagLightness,
        tagAlpha: this.plugin.settings.tagAlpha,
        columnHeaderWidth: this.plugin.settings.columnHeaderWidth,
        emptyColumnLabel: this.plugin.settings.emptyColumnLabel,
        addCardButtonText: this.plugin.settings.addCardButtonText,
        backgroundImage: this.config?.get(BACKGROUND_IMAGE_OPTION_KEY),
        backgroundBrightness: (this.config?.get(BACKGROUND_BRIGHTNESS_OPTION_KEY) as number | undefined) ??
          this.plugin.settings.backgroundBrightness,
        backgroundBlur: (this.config?.get(BACKGROUND_BLUR_OPTION_KEY) as number | undefined) ??
          this.plugin.settings.backgroundBlur,
        columnTransparency: (this.config?.get(COLUMN_TRANSPARENCY_OPTION_KEY) as number | undefined) ??
          this.plugin.settings.columnTransparency,
        columnBlur: (this.config?.get(COLUMN_BLUR_OPTION_KEY) as number | undefined) ??
          this.plugin.settings.columnBlur,
        onCreateCard: (grpByProperty: BasesPropertyId | null, grpKey: unknown) => this.createCardForColumn(grpByProperty, grpKey),
        onCardSelect: (filePath: string, extendSelection: boolean) => this.selectCard(filePath, extendSelection),
        onCardDragStart: (evt: DragEvent, filePath: string, cardIndex: number) => this.startCardDrag(evt, filePath, cardIndex),
        onCardDragEnd: () => this.endCardDrag(),
        onSetCardDropTarget: (_targetPath: string | null, _placement: "before" | "after" | null) => {
          // Drop target state is now managed in Svelte components
        },
        onCardDrop: (evt: DragEvent, filePath: string | null, grpKey: unknown) => this.handleCardDrop(evt, filePath, grpKey),
        onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) => this.showCardContextMenu(evt, entry.file),
        onCardLinkClick: (evt: MouseEvent, target: string) => this.handleCardLinkClick(evt, target),
        onCardsScroll: (columnKey: string, scrollTop: number) => this.handleColumnScroll(columnKey, scrollTop),
        onBoardScroll: (scrollLeft: number, scrollTop: number) => this.debouncedSaveBoardScrollPosition(scrollLeft, scrollTop),
        onBoardKeyDown: (evt: KeyboardEvent) => this.handleKeyDown(evt),
        onBoardClick: () => this.clearSelection(),
        onStartColumnDrag: (evt: DragEvent, columnKey: string) => this.startColumnDrag(evt, columnKey),
        onEndColumnDrag: () => this.endColumnDrag(),
        onSetColumnDropTarget: (_targetKey: string | null, _placement: "before" | "after" | null) => {
          // Drop target state is now managed in Svelte components
        },
        onColumnDrop: (targetKey: string, placement: "before" | "after") => this.handleColumnDrop(targetKey, placement),
      },
    });
  }

  private updateCheapUI(): void {
    this.applyBackgroundStyles();
  }

  private renderPlaceholder(): void {
    this.applyBackgroundStyles();
    this.rootEl.createEl("p", {
      text: this.plugin.settings.placeholderText,
      cls: "bases-kanban-placeholder",
    });
  }

  private applyBackgroundStyles(): void {
    const app = this.app as App;
    const config = {
      imageInput: this.config?.get(BACKGROUND_IMAGE_OPTION_KEY),
      brightness:
        (this.config?.get(BACKGROUND_BRIGHTNESS_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.backgroundBrightness,
      blur:
        (this.config?.get(BACKGROUND_BLUR_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.backgroundBlur,
      columnTransparency:
        (this.config?.get(COLUMN_TRANSPARENCY_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.columnTransparency,
      columnBlur:
        (this.config?.get(COLUMN_BLUR_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.columnBlur,
    };

    applyBackground(app, this.rootEl, this.backgroundManagerState, config);
  }

  private handleCardLinkClick(evt: MouseEvent, target: string): void {
    const isNewTab = evt.ctrlKey || evt.metaKey;
    const isOpenToRight = isNewTab && evt.altKey;
    void this.app.workspace.openLinkText(target, "", isOpenToRight ? "split" : isNewTab);
  }

  private showCardContextMenu(evt: MouseEvent, file: TFile): void {
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    const menu = new Menu();

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

    if (files.length > 1) {
      const confirmed = await new Promise<boolean>((resolve) => {
        const modal = new Modal(this.app as App);
        modal.titleEl.setText(`Move ${files.length} files to trash?`);
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
    const shortcutKey = this.plugin.settings.trashShortcutKey;
    if ((evt.metaKey || evt.ctrlKey) && evt.key === shortcutKey) {
      if (!hasSelection(this.selectionState)) {
        return;
      }

      evt.preventDefault();
      evt.stopPropagation();

      const filesToTrash: TFile[] = [];
      for (const path of this.selectionState.selectedPaths) {
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

  private getLocalCardOrderByColumn(): Map<string, string[]> {
    const configValue = this.config?.get(LOCAL_CARD_ORDER_OPTION_KEY);
    const { order, cache } = parseLocalCardOrder(
      configValue,
      this.localCardOrderCache,
    );
    this.localCardOrderCache = cache;
    return order;
  }

  private setLocalCardOrderByColumn(
    orderByColumn: Map<string, string[]>,
  ): void {
    this.localCardOrderCache = { order: null, raw: "" };
    this.config?.set(
      LOCAL_CARD_ORDER_OPTION_KEY,
      serializeLocalCardOrder(orderByColumn),
    );
  }

  private updateLocalCardOrderForDrop(
    sourceColumnKey: string | null,
    targetColumnKey: string,
    draggedPaths: string[],
    targetPath: string | null,
    placement: "before" | "after",
  ): void {
    if (draggedPaths.length === 0) {
      logDebug("CARD_ORDER", "updateLocalCardOrderForDrop - no dragged paths");
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

    logDebug("CARD_ORDER", "Updating local card order for drop", {
      sourceColumnKey: sourceColumnKey ?? "null",
      targetColumnKey,
      draggedCount: uniqueDraggedPaths.length,
      targetPath: targetPath ?? "null",
      placement,
    });

    const localOrderByColumn = this.getLocalCardOrderByColumn();
    if (sourceColumnKey === null || sourceColumnKey === targetColumnKey) {
      const currentPaths = this.getColumnCardPaths(targetColumnKey);
      const reorderedPaths = this.reorderPathsForDrop(
        currentPaths,
        uniqueDraggedPaths,
        targetPath,
        placement,
      );
      logDebug("CARD_ORDER", "Same-column reorder", {
        columnKey: targetColumnKey,
        beforeCount: currentPaths.length,
        afterCount: reorderedPaths.length,
      });
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

    logDebug("CARD_ORDER", "Cross-column reorder", {
      sourceColumnKey,
      targetColumnKey,
      sourceRemainingCount: sourcePaths.length,
      targetNewCount: reorderedTargetPaths.length,
    });

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

  private getColumnCardPaths(columnKey: string): string[] {
    const columnEl = this.rootEl.querySelector<HTMLElement>(`[data-column-key="${columnKey}"]`);
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

  private refreshEntryIndexes(groups: BasesEntryGroup[]): void {
    const indexes = buildEntryIndexes(groups);
    this.entryByPath = indexes.entryByPath;
    this.cardOrder = indexes.cardOrder;
    this.selectionState = syncSelectionWithEntries(
      this.selectionState,
      new Set(this.entryByPath.keys()),
    );
  }

  private refreshEntryIndexesFromRendered(
    renderedGroups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>,
  ): void {
    const indexes = buildEntryIndexes(renderedGroups);
    this.entryByPath = indexes.entryByPath;
    this.cardOrder = indexes.cardOrder;
    this.selectionState = syncSelectionWithEntries(
      this.selectionState,
      new Set(this.entryByPath.keys()),
    );
  }

  private getCardIndex(filePath: string): number {
    const index = this.cardOrder.indexOf(filePath);
    return index === -1 ? 0 : index;
  }

  private selectCard(filePath: string, extendSelection: boolean): void {
    const cardIndex = this.getCardIndex(filePath);

    this.selectionState = selectCardState(
      this.selectionState,
      filePath,
      cardIndex,
      extendSelection,
      () => this.cardOrder,
    );

    this.updateSvelteProps();
  }

  private clearSelection(): void {
    if (!hasSelection(this.selectionState)) {
      return;
    }

    this.selectionState = clearSelectionState();
    this.updateSvelteProps();
  }

  private updateSvelteProps(): void {
    // Trigger a re-render to update selection state
    // In a more optimized version, we could update only the selection props
    if (this.svelteApp !== null) {
      // Svelte 5 will automatically react to prop changes when we implement proper reactivity
      // For now, we rely on the next render cycle or data update
    }
  }

  // Card drag handlers (replaces drag-controller)
  private startCardDrag(evt: DragEvent, filePath: string, cardIndex: number): void {
    const draggedPaths = getDraggedPathsState(
      this.selectionState,
      filePath,
      this.cardOrder,
    );
    logDragEvent("Card drag started", {
      sourcePath: filePath,
      cardIndex,
      selectedCount: this.selectionState.selectedPaths.size,
      draggingCount: draggedPaths.length,
    });

    if (!isPathSelected(this.selectionState, filePath)) {
      this.selectionState = {
        selectedPaths: new Set([filePath]),
        lastSelectedIndex: cardIndex,
      };
      this.updateSvelteProps();
    }

    this.draggingCardSourcePath = filePath;

    if (evt.dataTransfer !== null) {
      evt.dataTransfer.effectAllowed = "move";
      evt.dataTransfer.setData("text/plain", filePath);
    }
  }

  private endCardDrag(): void {
    logDragEvent("Card drag ended");
    this.draggingCardSourcePath = null;
  }

  private async handleCardDrop(
    _evt: DragEvent,
    targetPath: string | null,
    groupKey: unknown,
  ): Promise<void> {
    if (this.draggingCardSourcePath === null) {
      logDragEvent("Drop aborted - no dragging source");
      return;
    }

    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(
        getSelectedProperties(this.data?.properties),
        this.allProperties,
      ),
    );

    if (groupByProperty === null) {
      logDragEvent("Drop aborted - no group by property");
      return;
    }

    // Get drop placement from the event or default to "after"
    const placement: "before" | "after" = "after";

    await this.handleDrop(groupByProperty, groupKey, targetPath, placement);
  }

  // Column drag handlers (replaces drag-controller)
  private startColumnDrag(evt: DragEvent, columnKey: string): void {
    logDragEvent("Column drag started", { columnKey });
    this.draggingColumnSourceKey = columnKey;

    if (evt.dataTransfer !== null) {
      evt.dataTransfer.effectAllowed = "move";
      evt.dataTransfer.setData("text/plain", columnKey);
    }
  }

  private endColumnDrag(): void {
    logDragEvent("Column drag ended");
    this.draggingColumnSourceKey = null;
  }

  private handleColumnDrop(
    targetColumnKey: string,
    placement: "before" | "after",
  ): void {
    const sourceColumnKey = this.draggingColumnSourceKey;
    logDragEvent("Column dropped", {
      sourceColumnKey: sourceColumnKey ?? "null",
      targetColumnKey,
      placement,
    });

    this.endColumnDrag();
    if (sourceColumnKey === null || sourceColumnKey === targetColumnKey) {
      logDragEvent("Column drop aborted - same column or no source");
      return;
    }

    const columnOrder = this.getColumnOrderFromConfig();
    const groups = mergeGroupsByColumnKey(this.data?.groupedData ?? []);
    const orderedGroups = sortGroupsByColumnOrder(groups, columnOrder);
    const orderedKeys = orderedGroups.map((g) => getColumnKey(g.key));
    const sourceIndex = orderedKeys.indexOf(sourceColumnKey);
    const targetIndex = orderedKeys.indexOf(targetColumnKey);
    if (sourceIndex === -1 || targetIndex === -1) {
      logDragEvent("Column drop aborted - index not found", {
        sourceIndex,
        targetIndex,
      });
      return;
    }

    const [moved] = orderedKeys.splice(sourceIndex, 1);
    let insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }
    orderedKeys.splice(insertionIndex, 0, moved);
    logDragEvent("Column order updated", {
      sourceIndex,
      targetIndex,
      insertionIndex,
      newOrder: orderedKeys,
    });
    this.updateColumnOrder(orderedKeys);
  }

  private handleColumnScroll(columnKey: string, scrollTop: number): void {
    saveColumnScrollPosition(this.viewSessionId, columnKey, scrollTop);
  }

  private getColumnOrderFromConfig(): string[] {
    const configValue = this.config?.get(COLUMN_ORDER_OPTION_KEY);
    const { order, cache } = parseColumnOrder(
      configValue,
      this.columnOrderCache,
    );
    this.columnOrderCache = cache;
    return order;
  }

  private updateColumnOrder(columnOrder: string[]): void {
    this.columnOrderCache = { order: null, raw: "" };
    this.config?.set(COLUMN_ORDER_OPTION_KEY, serializeColumnOrder(columnOrder));
  }

  private getDraggedPaths(sourcePath: string): string[] {
    return getDraggedPathsState(this.selectionState, sourcePath, this.cardOrder);
  }

  private async handleDrop(
    groupByProperty: BasesPropertyId,
    groupKey: unknown,
    targetPath: string | null,
    placement: "before" | "after",
  ): Promise<void> {
    const draggingSourcePath = this.draggingCardSourcePath;
    if (draggingSourcePath === null) {
      logDragEvent("Drop aborted - no dragging source");
      return;
    }

    const draggedPaths = this.getDraggedPaths(draggingSourcePath);
    const sourceEntry = this.entryByPath.get(draggingSourcePath);
    const sourceColumnKey =
      sourceEntry === undefined
        ? null
        : getColumnKey(sourceEntry.getValue(groupByProperty));
    const targetColumnKey = getColumnKey(groupKey);

    logDragEvent("Card dropped", {
      sourceColumnKey: sourceColumnKey ?? "null",
      targetColumnKey,
      draggedCount: draggedPaths.length,
      targetPath: targetPath ?? "null",
      placement,
      sameColumn: sourceColumnKey === targetColumnKey,
    });

    this.updateLocalCardOrderForDrop(
      sourceColumnKey,
      targetColumnKey,
      draggedPaths,
      targetPath,
      placement,
    );

    logDebug("DROP", "Local card order updated, calling mutation service");

    await this.mutationService.handleDrop({
      groupByProperty,
      groupByPropertyKey: getWritablePropertyKey(groupByProperty),
      groupKey,
      draggedPaths,
      entryByPath: this.entryByPath,
    });

    // Reset drag state
    this.draggingCardSourcePath = null;

    if (sourceColumnKey === targetColumnKey) {
      logDragEvent("Same column drop - skipping render (rely on reactivity)");
    } else {
      logDragEvent("Cross-column drop - expecting re-render from data update");
    }
  }

  private debouncedSaveBoardScrollPosition(
    scrollLeft: number,
    scrollTop: number,
  ): void {
    logScrollEvent("Debounced scroll save triggered", {
      scrollLeft,
      scrollTop,
    });
    if (this.scrollSaveTimeout !== null) {
      window.clearTimeout(this.scrollSaveTimeout);
    }
    this.scrollSaveTimeout = window.setTimeout(() => {
      logScrollEvent("Executing debounced scroll save");
      if (
        this.lastPersistedScrollState !== null &&
        this.lastPersistedScrollState.left === scrollLeft &&
        this.lastPersistedScrollState.top === scrollTop
      ) {
        logScrollEvent("Scroll save skipped - no change", {
          scrollLeft,
          scrollTop,
        });
        return;
      }

      this.scrollRevision = saveBoardScrollState(
        (key, value) => this.config?.set(key, value),
        BOARD_SCROLL_STATE_KEY,
        scrollLeft,
        scrollTop,
        this.viewSessionId,
        this.scrollRevision,
      );
      this.pendingLocalScrollRevision = this.scrollRevision;
      this.lastPersistedScrollState = { left: scrollLeft, top: scrollTop };
      this.scrollSaveTimeout = null;
    }, this.plugin.settings.scrollDebounceMs);
  }

  static getViewOptions() {
    return getKanbanViewOptions();
  }
}
