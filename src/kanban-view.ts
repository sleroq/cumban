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
import { writable, type Writable } from "svelte/store";

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
  BOARD_SCROLL_POSITION_KEY,
  BOARD_SCROLL_STATE_KEY,
  BOARD_SCROLL_TOP_POSITION_KEY,
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
import { buildEntryIndexes, type EntryGroupLike } from "./kanban-view/indexing";
import { KanbanMutationService } from "./kanban-view/mutations";
import {
  type ColumnOrderCache,
  type CardOrderCache,
  saveBoardScrollState,
  loadScrollState,
  loadLegacyScrollPosition,
  parseColumnOrder,
  serializeColumnOrder,
  parseLocalCardOrder,
  serializeLocalCardOrder,
  saveColumnScrollPosition,
  loadColumnScrollPosition,
} from "./kanban-view/state-persistence";
import { resolveBackgroundStyles } from "./kanban-view/background-manager";

import {
  type RenderedGroup,
  mergeGroupsByColumnKey,
  sortGroupsByColumnOrder,
  buildRenderedGroups,
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
  private viewSessionId: string;
  private hasRenderedBoard = false;
  private localCardOrderCache: CardOrderCache = { order: null, raw: "" };
  private columnOrderCache: ColumnOrderCache = { order: null, raw: "" };
  private svelteApp: ReturnType<typeof KanbanRoot> | null = null;
  private readonly selectedPathsStore: Writable<Set<string>>;
  // Store for KanbanRoot props to enable updates without remount
  private sveltePropsStore: Writable<{
    groups: RenderedGroup[];
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    columnScrollByKey: Record<string, number>;
  }> | null = null;
  // Cache of current rendered groups for data-driven operations
  // Avoids DOM queries for card order operations
  private currentRenderedGroups: RenderedGroup[] = [];

  // Drag state (replaces drag-controller)
  private draggingCardSourcePath: string | null = null;
  private draggingColumnSourceKey: string | null = null;

  // PERFORMANCE NOTES:
  // Large Board Mode (Future Enhancement):
  // If boards with >1000 cards become sluggish, consider implementing:
  //
  // 1. Column-level virtualization: Only render visible columns + 1 buffer
  //    on each side. Track visible range via IntersectionObserver on column
  //    container elements. Use transform/absolute positioning for scroll
  //    virtualization (similar to react-window).
  //
  // 2. Card-level virtualization within columns: For columns with >50 cards,
  //    virtualize the card list using similar technique. Each column would
  //    need its own virtual scroll container with estimated row heights.
  //
  // 3. Incremental rendering: For initial load, render first N cards per column
  //    then progressively render rest via requestIdleCallback or setTimeout
  //    chunks to keep UI responsive during large data loads.
  //
  // 4. Drag optimization: During drag, temporarily disable virtualization
  //    or expand buffer to prevent drag target elements from being unmounted.
  //
  // Current optimizations already in place:
  // - Svelte keyed each blocks for efficient DOM reuse
  // - RAF-throttled dragover calculations (reduces churn from 100s to 60fps max)
  // - Data-driven card order (no DOM queries during drop operations)
  // - Cached rendered groups for O(1) column lookups

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    plugin: BasesKanbanPlugin,
  ) {
    super(controller);
    this.plugin = plugin;
    this.viewSessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.selectionState = createSelectionState();
    this.selectedPathsStore = writable(this.selectionState.selectedPaths);
    this.rootEl = containerEl.createDiv({ cls: "bases-kanban-container" });
    this.mutationService = new KanbanMutationService(this.app as App);
  }

  onDataUpdated(): void {
    this.render();
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

    // Update background styles (always apply since they may change independently)
    this.applyBackgroundStyles();

    if (!hasConfiguredGroupBy(groups)) {
      logRenderEvent("Rendering placeholder (no group by)");
      if (this.svelteApp !== null) {
        this.unmountSvelteApp();
      }
      this.rootEl.empty();
      this.renderPlaceholder();
      this.hasRenderedBoard = false;
      return;
    }

    const localCardOrderByColumn = this.getLocalCardOrderByColumn();
    const columnOrder = this.getColumnOrderFromConfig();
    const orderedGroups = sortGroupsByColumnOrder(groups, columnOrder);
    const renderedGroups = buildRenderedGroups(orderedGroups, localCardOrderByColumn);

    // Cache rendered groups for data-driven operations (avoids DOM queries)
    this.currentRenderedGroups = renderedGroups;

    // Refresh entry indexes from rendered board order (needed for drag/drop and selection)
    // Must happen after column order and local card order are applied
    this.refreshEntryIndexes(renderedGroups);
    this.updateSvelteProps();

    const selectedProperties = getSelectedProperties(this.data?.properties);
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(selectedProperties, this.allProperties),
    );

    if (this.svelteApp === null) {
      logRenderEvent("Mounting Svelte app for first render");
      this.mountSvelteApp(renderedGroups, groupByProperty, selectedProperties);
      this.hasRenderedBoard = true;
    } else {
      logRenderEvent("Updating Svelte app props (Svelte handles DOM diffing)");
      this.updateSvelteAppProps(renderedGroups, groupByProperty, selectedProperties);
    }

    logRenderEvent("Render complete");
  }

  private mountSvelteApp(
    renderedGroups: RenderedGroup[],
    groupByProperty: BasesPropertyId | null,
    selectedProperties: BasesPropertyId[],
  ): void {
    // Get initial scroll positions for first mount
    const initialBoardScroll = this.getInitialBoardScroll();
    const columnScrollByKey: Record<string, number> = {};
    for (const { group } of renderedGroups) {
      const columnKey = getColumnKey(group.key);
      columnScrollByKey[columnKey] = loadColumnScrollPosition(
        this.viewSessionId,
        columnKey,
      );
    }

    // Create props store for reactive updates
    this.sveltePropsStore = writable({
      groups: renderedGroups,
      groupByProperty,
      selectedProperties,
      columnScrollByKey,
    });

    // Mount Svelte app once
    this.svelteApp = mount(KanbanRoot, {
      target: this.rootEl,
      props: {
        app: this.app as App,
        rootEl: this.rootEl,
        // Static props that don't change
        selectedPathsStore: this.selectedPathsStore,
        initialBoardScrollLeft: initialBoardScroll.left,
        initialBoardScrollTop: initialBoardScroll.top,
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
        // Store for reactive data props
        dataStore: this.sveltePropsStore,
        // Callbacks
        onCreateCard: (grpByProperty: BasesPropertyId | null, grpKey: unknown) => this.createCardForColumn(grpByProperty, grpKey),
        onCardSelect: (filePath: string, extendSelection: boolean) => this.selectCard(filePath, extendSelection),
        onCardDragStart: (evt: DragEvent, filePath: string, cardIndex: number) => this.startCardDrag(evt, filePath, cardIndex),
        onCardDragEnd: () => this.endCardDrag(),
        onCardDrop: (
          evt: DragEvent,
          filePath: string | null,
          grpKey: unknown,
          placement: "before" | "after",
        ) => this.handleCardDrop(evt, filePath, grpKey, placement),
        onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) => this.showCardContextMenu(evt, entry.file),
        onCardLinkClick: (evt: MouseEvent, target: string) => this.handleCardLinkClick(evt, target),
        onCardsScroll: (columnKey: string, scrollTop: number) => this.handleColumnScroll(columnKey, scrollTop),
        onBoardScroll: (scrollLeft: number, scrollTop: number) => this.debouncedSaveBoardScrollPosition(scrollLeft, scrollTop),
        onBoardKeyDown: (evt: KeyboardEvent) => this.handleKeyDown(evt),
        onBoardClick: () => this.clearSelection(),
        onStartColumnDrag: (evt: DragEvent, columnKey: string) => this.startColumnDrag(evt, columnKey),
        onEndColumnDrag: () => this.endColumnDrag(),
        onColumnDrop: (targetKey: string, placement: "before" | "after") => this.handleColumnDrop(targetKey, placement),
      },
    });
  }

  private updateSvelteAppProps(
    renderedGroups: RenderedGroup[],
    groupByProperty: BasesPropertyId | null,
    selectedProperties: BasesPropertyId[],
  ): void {
    if (this.sveltePropsStore === null) {
      return;
    }

    // Update column scroll positions for any new columns
    const columnScrollByKey: Record<string, number> = {};
    for (const { group } of renderedGroups) {
      const columnKey = getColumnKey(group.key);
      columnScrollByKey[columnKey] = loadColumnScrollPosition(
        this.viewSessionId,
        columnKey,
      );
    }

    // Update the store - Svelte handles efficient DOM updates via keyed each blocks
    this.sveltePropsStore.set({
      groups: renderedGroups,
      groupByProperty,
      selectedProperties,
      columnScrollByKey,
    });
  }

  private renderPlaceholder(): void {
    this.applyBackgroundStyles();
    this.rootEl.createEl("p", {
      text: this.plugin.settings.placeholderText,
      cls: "bases-kanban-placeholder",
    });
  }

  private applyBackgroundStyles(): void {
    // Build background config from current settings
    const config = {
      imageInput: this.config?.get(BACKGROUND_IMAGE_OPTION_KEY),
      brightness: (this.config?.get(BACKGROUND_BRIGHTNESS_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.backgroundBrightness,
      blur: (this.config?.get(BACKGROUND_BLUR_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.backgroundBlur,
      columnTransparency: (this.config?.get(COLUMN_TRANSPARENCY_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.columnTransparency,
      columnBlur: (this.config?.get(COLUMN_BLUR_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.columnBlur,
    };

    // Resolve styles using the centralized function
    const styles = resolveBackgroundStyles(this.app as App, config);

    // Apply column transparency CSS variable
    this.rootEl.style.setProperty(
      "--bases-kanban-column-transparency",
      String(styles.columnTransparencyValue),
    );

    // Apply column blur CSS variable
    this.rootEl.style.setProperty(
      "--bases-kanban-column-blur",
      `${styles.columnBlurValue}px`,
    );
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
    // Use cached rendered groups instead of querying DOM for better performance
    // This is O(groups) to find the right column, then O(entries) to extract paths
    for (const { group, entries } of this.currentRenderedGroups) {
      if (getColumnKey(group.key) === columnKey) {
        return entries.map((entry) => entry.file.path);
      }
    }
    return [];
  }

  private refreshEntryIndexes(groups: EntryGroupLike[]): void {
    const indexes = buildEntryIndexes(groups);
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
    // Use a fresh Set reference so store subscribers update predictably.
    this.selectedPathsStore.set(new Set(this.selectionState.selectedPaths));
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
    placement: "before" | "after",
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
      saveBoardScrollState(
        (key, value) => this.config?.set(key, value),
        BOARD_SCROLL_STATE_KEY,
        scrollLeft,
        scrollTop,
        this.viewSessionId,
      );
      this.scrollSaveTimeout = null;
    }, this.plugin.settings.scrollDebounceMs);
  }

  private getInitialBoardScroll(): { left: number; top: number } {
    const scrollState = loadScrollState(
      (key) => this.config?.get(key),
      BOARD_SCROLL_STATE_KEY,
    );
    if (scrollState !== null) {
      return { left: scrollState.left, top: scrollState.top };
    }

    const legacy = loadLegacyScrollPosition(
      (key) => this.config?.get(key),
      BOARD_SCROLL_POSITION_KEY,
      BOARD_SCROLL_TOP_POSITION_KEY,
    );
    return { left: legacy.scrollLeft, top: legacy.scrollTop };
  }

  private unmountSvelteApp(): void {
    if (this.svelteApp === null) {
      return;
    }
    unmount(this.svelteApp);
    this.svelteApp = null;
    this.sveltePropsStore = null;
  }

  onClose(): void {
    if (this.scrollSaveTimeout !== null) {
      window.clearTimeout(this.scrollSaveTimeout);
      this.scrollSaveTimeout = null;
    }
    this.unmountSvelteApp();
    this.rootEl.empty();
  }

  static getViewOptions() {
    return getKanbanViewOptions();
  }
}
