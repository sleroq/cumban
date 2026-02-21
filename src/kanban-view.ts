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
  BOARD_SCROLL_POSITION_KEY,
  BOARD_SCROLL_STATE_KEY,
  BOARD_SCROLL_TOP_POSITION_KEY,
  COLUMN_BLUR_OPTION_KEY,
  COLUMN_ORDER_OPTION_KEY,
  COLUMN_TRANSPARENCY_OPTION_KEY,
  LOCAL_CARD_ORDER_OPTION_KEY,
  NO_VALUE_COLUMN_KEY,
  PINNED_COLUMNS_OPTION_KEY,
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
  type PinnedColumnsCache,
  saveBoardScrollState,
  loadScrollState,
  loadLegacyScrollPosition,
  parseColumnOrder,
  serializeColumnOrder,
  parseLocalCardOrder,
  serializeLocalCardOrder,
  saveColumnScrollPosition,
  loadColumnScrollPosition,
  parsePinnedColumns,
  serializePinnedColumns,
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
import {
  createKanbanViewModel,
  type KanbanViewModel,
} from "./kanban-view/view-model";

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
  private localCardOrderCache: CardOrderCache = { order: null, raw: "" };
  private columnOrderCache: ColumnOrderCache = { order: null, raw: "" };
  private pinnedColumnsCache: PinnedColumnsCache = { columns: null, raw: "" };
  private svelteApp: ReturnType<typeof KanbanRoot> | null = null;
  private readonly viewModel: KanbanViewModel;
  // Cache of current rendered groups for data-driven operations
  // Avoids DOM queries for card order operations
  private currentRenderedGroups: RenderedGroup[] = [];

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
    this.viewModel = createKanbanViewModel();
    this.viewModel.setSelectedPaths(this.selectionState.selectedPaths);
    this.rootEl = containerEl.createDiv({ cls: "bases-kanban-container" });
    this.mutationService = new KanbanMutationService(this.app as App);
    this.plugin.registerKanbanView(this);
  }

  onPluginSettingsChanged(): void {
    this.applyBackgroundStyles();
  }

  onDataUpdated(): void {
    this.render();
  }

  private render(): void {
    logRenderEvent("render() called");

    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    const pinnedColumns = this.getPinnedColumnsFromConfig();
    const groupsWithPinned = this.injectPinnedEmptyColumns(
      rawGroups,
      pinnedColumns,
    );
    const groups = mergeGroupsByColumnKey(groupsWithPinned);

    const localCardOrderByColumn = this.getLocalCardOrderByColumn();
    logRenderEvent("Data prepared", {
      rawGroupCount: rawGroups.length,
      mergedGroupCount: groups.length,
      totalEntries: groups.reduce((sum, g) => sum + g.entries.length, 0),
      localOrderColumnCount: localCardOrderByColumn.size,
      localOrderKeys: Array.from(localCardOrderByColumn.keys()),
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
      return;
    }

    const columnOrder = this.getColumnOrderFromConfig();
    const orderedGroups = sortGroupsByColumnOrder(groups, columnOrder);
    const renderedGroups = buildRenderedGroups(
      orderedGroups,
      localCardOrderByColumn,
    );

    // Debug: Log first column's entry order
    if (renderedGroups.length > 0) {
      const firstColumn = renderedGroups[0];
      const columnKey = getColumnKey(firstColumn.group.key);
      logRenderEvent("First column entries", {
        columnKey,
        entryCount: firstColumn.entries.length,
        firstPaths: firstColumn.entries.slice(0, 3).map((e) => e.file.path),
      });
    }

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
    } else {
      logRenderEvent("Updating Svelte app props (Svelte handles DOM diffing)");
      this.updateSvelteAppProps(
        renderedGroups,
        groupByProperty,
        selectedProperties,
      );
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

    // Set initial store values
    this.viewModel.setBoardData({
      groups: renderedGroups,
      groupByProperty,
      selectedProperties,
    });
    this.viewModel.setColumnScrollByKey(columnScrollByKey);
    this.viewModel.setPinnedColumns(new Set(this.getPinnedColumnsFromConfig()));

    // Mount Svelte app once
    this.svelteApp = mount(KanbanRoot, {
      target: this.rootEl,
      props: {
        app: this.app as App,
        rootEl: this.rootEl,
        // Static props that don't change
        selectedPathsStore: this.viewModel.selectedPathsStore,
        initialBoardScrollLeft: initialBoardScroll.left,
        initialBoardScrollTop: initialBoardScroll.top,
        settings: this.plugin.settings,
        backgroundImage: this.config?.get(BACKGROUND_IMAGE_OPTION_KEY),
        backgroundBrightness:
          (this.config?.get(BACKGROUND_BRIGHTNESS_OPTION_KEY) as
            | number
            | undefined) ?? this.plugin.settings.backgroundBrightness,
        backgroundBlur:
          (this.config?.get(BACKGROUND_BLUR_OPTION_KEY) as
            | number
            | undefined) ?? this.plugin.settings.backgroundBlur,
        columnTransparency:
          (this.config?.get(COLUMN_TRANSPARENCY_OPTION_KEY) as
            | number
            | undefined) ?? this.plugin.settings.columnTransparency,
        columnBlur:
          (this.config?.get(COLUMN_BLUR_OPTION_KEY) as number | undefined) ??
          this.plugin.settings.columnBlur,
        // Reactive stores
        groupsStore: this.viewModel.groupsStore,
        groupByPropertyStore: this.viewModel.groupByPropertyStore,
        selectedPropertiesStore: this.viewModel.selectedPropertiesStore,
        columnScrollByKeyStore: this.viewModel.columnScrollByKeyStore,
        pinnedColumnsStore: this.viewModel.pinnedColumnsStore,
        // Callbacks
        onCreateCard: (
          grpByProperty: BasesPropertyId | null,
          grpKey: unknown,
        ) => this.createCardForColumn(grpByProperty, grpKey),
        onCardSelect: (filePath: string, extendSelection: boolean) =>
          this.selectCard(filePath, extendSelection),
        onCardDragStart: (
          filePath: string,
          cardIndex: number,
        ) => this.startCardDrag(filePath, cardIndex),
        onCardDragEnd: () => this.endCardDrag(),
        onCardDrop: (
          sourcePath: string | null,
          filePath: string | null,
          grpKey: unknown,
          placement: "before" | "after",
        ) => this.handleCardDrop(sourcePath, filePath, grpKey, placement),
        onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) =>
          this.showCardContextMenu(evt, entry.file),
        onCardLinkClick: (evt: MouseEvent, target: string) =>
          this.handleCardLinkClick(evt, target),
        onCardsScroll: (columnKey: string, scrollTop: number) =>
          this.handleColumnScroll(columnKey, scrollTop),
        onBoardScroll: (scrollLeft: number, scrollTop: number) =>
          this.debouncedSaveBoardScrollPosition(scrollLeft, scrollTop),
        onBoardKeyDown: (evt: KeyboardEvent) => this.handleKeyDown(evt),
        onBoardClick: () => this.clearSelection(),
        onStartColumnDrag: (columnKey: string) =>
          this.startColumnDrag(columnKey),
        onEndColumnDrag: () => this.endColumnDrag(),
        onColumnDrop: (
          sourceKey: string | null,
          targetKey: string,
          placement: "before" | "after",
        ) => this.handleColumnDrop(sourceKey, targetKey, placement),
        onTogglePin: (columnKey: string) => this.toggleColumnPin(columnKey),
      },
    });
  }

  private updateSvelteAppProps(
    renderedGroups: RenderedGroup[],
    groupByProperty: BasesPropertyId | null,
    selectedProperties: BasesPropertyId[],
  ): void {
    // Only load scroll positions for new columns (not already in store)
    // This avoids re-setting scroll positions for existing columns on every update
    const currentScrollByKey = this.viewModel.getColumnScrollByKey();
    const columnScrollByKey: Record<string, number> = {};
    let hasNewColumns = false;

    for (const { group } of renderedGroups) {
      const columnKey = getColumnKey(group.key);
      if (columnKey in currentScrollByKey) {
        // Preserve existing scroll position for known columns
        columnScrollByKey[columnKey] = currentScrollByKey[columnKey]!;
      } else {
        // Load scroll position for new columns
        columnScrollByKey[columnKey] = loadColumnScrollPosition(
          this.viewSessionId,
          columnKey,
        );
        hasNewColumns = true;
      }
    }

    // Update stores to trigger Svelte reactivity
    this.viewModel.setBoardData({
      groups: renderedGroups,
      groupByProperty,
      selectedProperties,
    });

    // Only update scroll store if there are new columns
    if (hasNewColumns) {
      this.viewModel.setColumnScrollByKey(columnScrollByKey);
    }

    logRenderEvent("Stores updated", {
      groupCount: renderedGroups.length,
      newColumns: hasNewColumns,
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
      brightness:
        (this.config?.get(BACKGROUND_BRIGHTNESS_OPTION_KEY) as
          | number
          | undefined) ?? this.plugin.settings.backgroundBrightness,
      blur:
        (this.config?.get(BACKGROUND_BLUR_OPTION_KEY) as number | undefined) ??
        this.plugin.settings.backgroundBlur,
      columnTransparency:
        (this.config?.get(COLUMN_TRANSPARENCY_OPTION_KEY) as
          | number
          | undefined) ?? this.plugin.settings.columnTransparency,
      columnBlur:
        (this.config?.get(COLUMN_BLUR_OPTION_KEY) as number | undefined) ??
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

    const backgroundEl = this.rootEl.querySelector<HTMLDivElement>(
      ".bases-kanban-background",
    );
    if (backgroundEl !== null) {
      backgroundEl.style.filter = styles.backgroundFilter;
    }
  }

  private handleCardLinkClick(evt: MouseEvent, target: string): void {
    const isNewTab = evt.ctrlKey || evt.metaKey;
    const isOpenToRight = isNewTab && evt.altKey;
    void this.app.workspace.openLinkText(
      target,
      "",
      isOpenToRight ? "split" : isNewTab,
    );
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
        confirmButton.style.backgroundColor =
          "var(--background-modifier-error)";
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
    this.viewModel.setSelectedPaths(this.selectionState.selectedPaths);
  }

  // Card drag handlers (replaces drag-controller)
  private startCardDrag(
    filePath: string,
    cardIndex: number,
  ): void {
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

    this.viewModel.startCardDrag(filePath);

  }

  private endCardDrag(): void {
    logDragEvent("Card drag ended");
    this.viewModel.endCardDrag();
  }

  private async handleCardDrop(
    sourcePath: string | null,
    targetPath: string | null,
    groupKey: unknown,
    placement: "before" | "after",
  ): Promise<void> {
    if (sourcePath === null) {
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

    await this.handleDrop(
      sourcePath,
      groupByProperty,
      groupKey,
      targetPath,
      placement,
    );
  }

  // Column drag handlers (replaces drag-controller)
  private startColumnDrag(columnKey: string): void {
    logDragEvent("Column drag started", { columnKey });
    this.viewModel.startColumnDrag(columnKey);
  }

  private endColumnDrag(): void {
    logDragEvent("Column drag ended");
    this.viewModel.endColumnDrag();
  }

  private handleColumnDrop(
    sourceColumnKey: string | null,
    targetColumnKey: string,
    placement: "before" | "after",
  ): void {
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
    this.config?.set(
      COLUMN_ORDER_OPTION_KEY,
      serializeColumnOrder(columnOrder),
    );
  }

  private getPinnedColumnsFromConfig(): string[] {
    const configValue = this.config?.get(PINNED_COLUMNS_OPTION_KEY);
    const { columns, cache } = parsePinnedColumns(
      configValue,
      this.pinnedColumnsCache,
    );
    this.pinnedColumnsCache = cache;
    return columns;
  }

  private updatePinnedColumns(pinnedColumns: string[]): void {
    this.pinnedColumnsCache = { columns: null, raw: "" };
    this.config?.set(
      PINNED_COLUMNS_OPTION_KEY,
      serializePinnedColumns(pinnedColumns),
    );
    // Update store to trigger re-render
    this.viewModel.setPinnedColumns(new Set(pinnedColumns));
  }

  private toggleColumnPin(columnKey: string): void {
    const currentPinned = this.getPinnedColumnsFromConfig();
    const pinnedSet = new Set(currentPinned);

    if (pinnedSet.has(columnKey)) {
      pinnedSet.delete(columnKey);
    } else {
      pinnedSet.add(columnKey);
    }

    const newPinned = [...pinnedSet];
    this.updatePinnedColumns(newPinned);
    logDebug("PIN", `Toggled pin for ${columnKey}`, {
      isPinned: pinnedSet.has(columnKey),
      totalPinned: newPinned.length,
    });
  }

  private injectPinnedEmptyColumns(
    groups: BasesEntryGroup[],
    pinnedColumns: string[],
  ): BasesEntryGroup[] {
    if (pinnedColumns.length === 0) {
      return groups;
    }

    const existingKeys = new Set(groups.map((g) => getColumnKey(g.key)));
    const syntheticGroups: BasesEntryGroup[] = [];

    for (const columnKey of pinnedColumns) {
      if (!existingKeys.has(columnKey)) {
        const isNoValueColumn = columnKey === NO_VALUE_COLUMN_KEY;
        syntheticGroups.push({
          key: isNoValueColumn
            ? (undefined as unknown as BasesEntryGroup["key"])
            : (columnKey as unknown as BasesEntryGroup["key"]),
          hasKey: (): boolean => !isNoValueColumn,
          entries: [],
        });
      }
    }

    if (syntheticGroups.length > 0) {
      logDebug(
        "PIN",
        `Injected ${syntheticGroups.length} empty pinned columns`,
      );
    }

    return [...groups, ...syntheticGroups];
  }

  private getDraggedPaths(sourcePath: string): string[] {
    return getDraggedPathsState(
      this.selectionState,
      sourcePath,
      this.cardOrder,
    );
  }

  private async handleDrop(
    sourcePath: string,
    groupByProperty: BasesPropertyId,
    groupKey: unknown,
    targetPath: string | null,
    placement: "before" | "after",
  ): Promise<void> {
    const draggedPaths = this.getDraggedPaths(sourcePath);
    const sourceEntry = this.entryByPath.get(sourcePath);
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
    this.viewModel.endCardDrag();

    // Always render after drop to show updated card order
    // Same-column reordering updates local card order config,
    // so we need to rebuild rendered groups with the new order applied
    logDragEvent("Triggering render after drop");
    this.render();
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
  }

  onClose(): void {
    if (this.scrollSaveTimeout !== null) {
      window.clearTimeout(this.scrollSaveTimeout);
      this.scrollSaveTimeout = null;
    }
    this.unmountSvelteApp();
    this.rootEl.empty();
    this.plugin.unregisterKanbanView(this);
  }

  static getViewOptions() {
    return getKanbanViewOptions();
  }
}
