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
  logCacheEvent,
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
  private cachedColumnBlurValue: number | null = null;
  private backgroundImageLoadVersion = 0;
  private cardElByPath = new Map<string, HTMLElement>();
  private columnElByKey = new Map<string, HTMLElement>();
  private viewSessionId: string;
  private scrollRevision = 0;
  private pendingLocalScrollRevision: number | null = null;
  private hasRenderedBoard = false;
  private lastPersistedScrollState: { left: number; top: number } | null = null;
  private lastRenderSignature: string | null = null;
  private localCardOrderCache: CardOrderCache = { order: null, raw: "" };
  private columnOrderCache: ColumnOrderCache = { order: null, raw: "" };
  private lastColumnPathSnapshots = new Map<string, string[]>();

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    plugin: BasesKanbanPlugin,
  ) {
    super(controller);
    this.plugin = plugin;
    this.viewSessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
      onSelectCard: (filePath, extendSelection) => {
        this.selectCard(filePath, extendSelection);
      },
      onGetCardIndex: (filePath) => {
        return this.getCardIndex(filePath);
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

  private computeRenderSignature(
    groups: BasesEntryGroup[],
    displaySettings: {
      cardTitleSource: string;
      cardTitleMaxLength: number;
      propertyValueSeparator: string;
      tagPropertySuffix: string;
      tagSaturation: number;
      tagLightness: number;
      tagAlpha: number;
    },
    localCardOrderByColumn: Map<string, string[]>,
    selectedProperties: BasesPropertyId[],
    groupByProperty: BasesPropertyId | null,
  ): string {
    const groupKeys = groups.map((g) => getColumnKey(g.key)).join("|");
    const entryPaths = groups
      .flatMap((g) => g.entries.map((e) => e.file.path))
      .join("|");
    const settingsHash = JSON.stringify(displaySettings);
    const localOrderHash = JSON.stringify([
      ...localCardOrderByColumn.entries(),
    ]);

    // Compute property values hash for visible properties
    // This ensures re-render when card properties (like tags) change
    const propertiesToTrack = selectedProperties.filter(
      (propertyId) =>
        propertyId !== "file.name" && propertyId !== groupByProperty,
    );

    const propertyValuesHash = this.computePropertyValuesHash(
      groups,
      propertiesToTrack,
    );

    const signature = `${groupKeys}::${entryPaths}::${settingsHash}::${localOrderHash}::${propertyValuesHash}`;

    logCacheEvent("Computed render signature", {
      groupCount: groups.length,
      entryCount: groups.reduce((sum, g) => sum + g.entries.length, 0),
      hasLocalOrder: localCardOrderByColumn.size > 0,
      trackedProperties: propertiesToTrack.length,
      signatureLength: signature.length,
    });

    return signature;
  }

  private computePropertyValuesHash(
    groups: BasesEntryGroup[],
    propertiesToTrack: BasesPropertyId[],
  ): string {
    if (propertiesToTrack.length === 0) {
      return "";
    }

    const parts: string[] = [];

    for (const group of groups) {
      for (const entry of group.entries) {
        const entryPath = entry.file.path;

        for (const propertyId of propertiesToTrack) {
          const value = entry.getValue(propertyId);
          // Normalize value for consistent hashing
          let valueStr: string;

          if (value === null || value === undefined) {
            valueStr = "__null__";
          } else {
            valueStr = String(value);
          }

          parts.push(`${entryPath}:${propertyId}=${valueStr}`);
        }
      }
    }

    // Use a simple hash function for the combined string
    let hash = 0;
    const combined = parts.join("|");

    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }

    return hash.toString(36);
  }

  private canSkipFullRender(currentSignature: string): boolean {
    if (!this.hasRenderedBoard || this.lastRenderSignature === null) {
      logCacheEvent("Cannot skip - no previous render", {
        hasRenderedBoard: this.hasRenderedBoard,
        hasLastSignature: this.lastRenderSignature !== null,
      });
      return false;
    }

    if (currentSignature !== this.lastRenderSignature) {
      logCacheEvent("Cannot skip - signature changed");
      return false;
    }

    logCacheEvent("Signature match - skipping full render");
    return true;
  }

  private computeColumnSnapshots(
    renderedGroups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>,
  ): Map<string, string[]> {
    const snapshots = new Map<string, string[]>();
    for (const { group, entries } of renderedGroups) {
      const columnKey = getColumnKey(group.key);
      snapshots.set(
        columnKey,
        entries.map((e) => e.file.path),
      );
    }
    return snapshots;
  }

  private findChangedColumns(
    previous: Map<string, string[]>,
    current: Map<string, string[]>,
  ): string[] {
    const changed: string[] = [];

    for (const [key, currentPaths] of current) {
      const previousPaths = previous.get(key);
      if (previousPaths === undefined) {
        // New column
        changed.push(key);
        continue;
      }
      if (currentPaths.length !== previousPaths.length) {
        changed.push(key);
        continue;
      }
      for (let i = 0; i < currentPaths.length; i++) {
        if (currentPaths[i] !== previousPaths[i]) {
          changed.push(key);
          break;
        }
      }
    }

    // Check for removed columns
    for (const key of previous.keys()) {
      if (!current.has(key)) {
        changed.push(key);
      }
    }

    return changed;
  }

  private canRenderPartially(
    renderedGroups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>,
  ): { canPartial: boolean; changedColumns: string[] } {
    if (!this.hasRenderedBoard || this.lastColumnPathSnapshots.size === 0) {
      return { canPartial: false, changedColumns: [] };
    }

    const currentSnapshots = this.computeColumnSnapshots(renderedGroups);
    const changedColumns = this.findChangedColumns(
      this.lastColumnPathSnapshots,
      currentSnapshots,
    );

    // Check if board structure is unchanged
    const boardStructureChanged =
      currentSnapshots.size !== this.lastColumnPathSnapshots.size ||
      changedColumns.some((key) => !this.lastColumnPathSnapshots.has(key));

    if (boardStructureChanged) {
      logCacheEvent("Cannot partial render - board structure changed", {
        previousColumnCount: this.lastColumnPathSnapshots.size,
        currentColumnCount: currentSnapshots.size,
        newOrRemovedColumns: changedColumns.filter(
          (k) =>
            !this.lastColumnPathSnapshots.has(k) || !currentSnapshots.has(k),
        ).length,
      });
      return { canPartial: false, changedColumns: [] };
    }

    if (changedColumns.length === 0) {
      return { canPartial: false, changedColumns: [] };
    }

    // Limit partial render to reasonable number of changed columns
    if (changedColumns.length > 5) {
      logCacheEvent("Too many changed columns for partial render", {
        changedCount: changedColumns.length,
      });
      return { canPartial: false, changedColumns: [] };
    }

    logCacheEvent("Can partial render", {
      changedColumnCount: changedColumns.length,
      changedColumns: changedColumns.join(","),
    });

    return { canPartial: true, changedColumns };
  }

  private renderPartial(
    renderedGroups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>,
    changedColumnKeys: string[],
    context: RenderContext,
  ): void {
    logRenderEvent("PARTIAL RENDER - replacing columns", {
      changedCount: changedColumnKeys.length,
      changedKeys: changedColumnKeys.join(","),
    });

    const boardEl = this.rootEl.querySelector<HTMLElement>(
      ".bases-kanban-board",
    );
    if (boardEl === null) {
      logRenderEvent(
        "PARTIAL RENDER - board not found, falling back to full render",
      );
      return;
    }

    // Build a map of rendered groups by key for quick lookup
    const groupByKey = new Map(
      renderedGroups.map((rg) => [getColumnKey(rg.group.key), rg]),
    );

    // Calculate starting card index for each column
    let cardIndex = 0;
    const columnCardIndexes = new Map<string, number>();
    for (const { group } of renderedGroups) {
      const key = getColumnKey(group.key);
      columnCardIndexes.set(key, cardIndex);
      const rg = groupByKey.get(key);
      if (rg !== undefined) {
        cardIndex += rg.entries.length;
      }
    }

    // Replace only changed columns
    for (const columnKey of changedColumnKeys) {
      const existingColumn = this.columnElByKey.get(columnKey);
      const renderedGroup = groupByKey.get(columnKey);

      if (
        renderedGroup === undefined ||
        existingColumn === undefined ||
        existingColumn === null
      ) {
        logRenderEvent("PARTIAL RENDER - column not found, skipping", {
          columnKey,
        });
        continue;
      }

      // Create new column with updated content
      const startIndex = columnCardIndexes.get(columnKey) ?? 0;
      const newColumnEl = this.renderer.renderColumnDetached(
        columnKey,
        renderedGroup.group.key,
        renderedGroup.entries,
        startIndex,
        context,
      );

      // Replace in DOM
      existingColumn.replaceWith(newColumnEl);

      // Update element index
      this.columnElByKey.set(columnKey, newColumnEl);

      // Update card indexes
      const cards =
        newColumnEl.querySelectorAll<HTMLElement>(".bases-kanban-card");
      for (let i = 0; i < cards.length; i++) {
        const cardEl = cards[i];
        const path = cardEl.dataset.cardPath;
        if (typeof path === "string" && path.length > 0) {
          this.cardElByPath.set(path, cardEl);
        }
      }

      // Restore scroll position for this column if we tracked it
      this.restoreColumnScrollPosition(columnKey, newColumnEl);
    }

    // Update global state
    this.refreshEntryIndexesFromRendered(renderedGroups);
    this.lastColumnPathSnapshots = this.computeColumnSnapshots(renderedGroups);

    logRenderEvent("PARTIAL RENDER COMPLETE", {
      replacedColumns: changedColumnKeys.length,
    });
  }

  private restoreColumnScrollPosition(
    columnKey: string,
    columnEl: HTMLElement,
  ): void {
    const scrollTop = loadColumnScrollPosition(this.viewSessionId, columnKey);
    if (scrollTop <= 0) {
      return;
    }

    // Defer scroll restoration to next animation frame when layout is computed
    window.requestAnimationFrame(() => {
      const cardsEl = columnEl.querySelector<HTMLElement>(
        ".bases-kanban-cards",
      );
      if (cardsEl !== null) {
        cardsEl.scrollTop = scrollTop;
        logScrollEvent("Column scroll restored", { columnKey, scrollTop });
      }
    });
  }

  private updateCheapUI(): void {
    this.applyBackgroundStyles();
    this.updateSelectionStyles();
  }

  private render(): void {
    logRenderEvent("render() called");

    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    const groups = this.mergeGroupsByColumnKey(rawGroups);

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

    // Compute these early for signature comparison
    const selectedProperties = getSelectedProperties(this.data?.properties);
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(selectedProperties, this.allProperties),
    );

    const currentSignature = this.computeRenderSignature(
      groups,
      displaySettings,
      localCardOrderByColumn,
      selectedProperties,
      groupByProperty,
    );

    if (this.canSkipFullRender(currentSignature)) {
      logRenderEvent(
        "SKIPPED - full render not needed, updating cheap UI only",
      );
      this.updateCheapUI();
      return;
    }

    if (!hasConfiguredGroupBy(groups)) {
      logRenderEvent("Proceeding with FULL DOM RENDER (no group by)");
      this.rootEl.empty();
      this.applyBackgroundStyles();
      this.refreshEntryIndexes(groups);
      this.clearElementIndexes();
      this.renderPlaceholder();
      return;
    }

    const orderedGroups = this.sortGroupsByColumnOrder(groups);
    const renderedGroups = orderedGroups.map((group) => ({
      group,
      entries: this.applyLocalCardOrder(
        getColumnKey(group.key),
        group.entries,
        localCardOrderByColumn,
      ),
    }));

    // Try partial render first (for cross-column moves or single-card adds)
    const { canPartial, changedColumns } = this.canRenderPartially(renderedGroups);

    if (canPartial && changedColumns.length > 0) {
      const context: RenderContext = {
        selectedProperties,
        groupByProperty,
        selectedPaths: this.selectedPaths,
        getDraggingColumnKey: () =>
          this.dragController.getColumnDragSourceKey(),
        getDraggingSourcePath: () =>
          this.dragController.getCardDragSourcePath(),
        getColumnDropPlacement: () =>
          this.dragController.getColumnDropPlacement(),
        getCardDropPlacement: () => this.dragController.getCardDropPlacement(),
        getCardDropTargetPath: () =>
          this.dragController.getCardDropTargetPath(),
        emptyColumnLabel: this.plugin.settings.emptyColumnLabel,
        addCardButtonText: this.plugin.settings.addCardButtonText,
        cardTitleSource: this.plugin.settings.cardTitleSource,
        cardTitleMaxLength: this.plugin.settings.cardTitleMaxLength,
        propertyValueSeparator: this.plugin.settings.propertyValueSeparator,
        tagPropertySuffix: this.plugin.settings.tagPropertySuffix,
        tagSaturation: this.plugin.settings.tagSaturation,
        tagLightness: this.plugin.settings.tagLightness,
        tagAlpha: this.plugin.settings.tagAlpha,
        columnHeaderWidth: this.plugin.settings.columnHeaderWidth,
      };

      this.renderPartial(renderedGroups, changedColumns, context);

      // Update signature and snapshots for next render
      this.lastRenderSignature = this.computeRenderSignature(
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

    const previousBoardScrollLeft = this.getBoardScrollLeft();
    this.rootEl.empty();
    this.applyBackgroundStyles();

    this.refreshEntryIndexesFromRendered(renderedGroups);

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
      columnHeaderWidth: this.plugin.settings.columnHeaderWidth,
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

    logRenderEvent("DOM built, element indexes refreshed", {
      columnCount: this.columnElByKey.size,
      cardCount: this.cardElByPath.size,
    });

    // Restore column scroll positions for full render
    for (const { group } of renderedGroups) {
      const columnKey = getColumnKey(group.key);
      const columnEl = this.columnElByKey.get(columnKey);
      if (columnEl !== undefined) {
        this.restoreColumnScrollPosition(columnKey, columnEl);
      }
    }

    // Load saved scroll position to restore vertical scroll
    const savedScroll = this.loadBoardScrollPosition();

    // Use current horizontal scroll if re-rendering, otherwise use saved
    const finalScrollLeft = this.hasRenderedBoard
      ? previousBoardScrollLeft
      : savedScroll.scrollLeft;

    // Always restore vertical scroll from saved state
    this.restoreBoardScrollPosition(finalScrollLeft, savedScroll.scrollTop);
    this.hasRenderedBoard = true;
    this.lastRenderSignature = this.computeRenderSignature(
      groups,
      displaySettings,
      localCardOrderByColumn,
      selectedProperties,
      groupByProperty,
    );
    this.lastColumnPathSnapshots = this.computeColumnSnapshots(renderedGroups);
    const scrollRestored = !this.hasRenderedBoard;
    this.hasRenderedBoard = true;

    logRenderEvent("FULL RENDER COMPLETE", {
      scrollRestored,
      finalScrollLeft,
    });
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

  private restoreBoardScrollPosition(
    scrollLeft: number,
    scrollTop: number,
  ): void {
    const boardEl = this.rootEl.querySelector<HTMLElement>(
      ".bases-kanban-board",
    );
    if (boardEl === null) {
      return;
    }

    // Defer scroll restoration to next animation frame when layout is computed
    window.requestAnimationFrame(() => {
      if (!this.rootEl.contains(boardEl)) {
        return;
      }
      if (scrollLeft > 0) {
        boardEl.scrollLeft = scrollLeft;
      }
      if (scrollTop > 0) {
        boardEl.scrollTop = scrollTop;
      }
      logScrollEvent("Board scroll restored", { scrollLeft, scrollTop });
    });
  }

  private setupBoardScrollListener(boardEl: HTMLElement): void {
    boardEl.addEventListener("scroll", (evt) => {
      const target = evt.target as HTMLElement;
      this.debouncedSaveBoardScrollPosition(
        target.scrollLeft,
        target.scrollTop,
      );
    });
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

  private loadBoardScrollPosition(): { scrollLeft: number; scrollTop: number } {
    const scrollState = loadScrollState(
      (key) => this.config?.get(key),
      BOARD_SCROLL_STATE_KEY,
    );
    if (scrollState !== null) {
      return {
        scrollLeft: scrollState.left,
        scrollTop: scrollState.top,
      };
    }

    return loadLegacyScrollPosition(
      (key) => this.config?.get(key),
      BOARD_SCROLL_POSITION_KEY,
      BOARD_SCROLL_TOP_POSITION_KEY,
    );
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
    const columnBlur = this.getConfigNumber(
      COLUMN_BLUR_OPTION_KEY,
      this.plugin.settings.columnBlur,
      0,
      20,
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

    // Apply column blur CSS variable
    if (this.cachedColumnBlurValue !== columnBlur) {
      this.rootEl.style.setProperty(
        "--bases-kanban-column-blur",
        `${columnBlur}px`,
      );
      this.cachedColumnBlurValue = columnBlur;
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
      if (
        createdBackgroundElement ||
        this.cachedBackgroundFilter !== nextFilter
      ) {
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
    this.cachedColumnBlurValue = null;
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

  private getCardIndex(filePath: string): number {
    const index = this.cardOrder.indexOf(filePath);
    return index === -1 ? 0 : index;
  }

  private selectCard(filePath: string, extendSelection: boolean): void {
    const cardIndex = this.getCardIndex(filePath);

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
    const draggedPaths = this.getDraggedPaths(filePath);
    logDragEvent("Card drag started", {
      sourcePath: filePath,
      cardIndex,
      selectedCount: this.selectedPaths.size,
      draggingCount: draggedPaths.length,
    });

    if (!this.selectedPaths.has(filePath)) {
      this.selectedPaths = new Set([filePath]);
      this.lastSelectedIndex = cardIndex;
      this.updateSelectionStyles();
    }

    this.dragController.startCardDrag(evt, filePath);

    for (const path of draggedPaths) {
      const cardEl = this.getCardEl(path);
      cardEl?.addClass("bases-kanban-card-dragging");
    }
  }

  private endDrag(): void {
    logDragEvent("Card drag ended");
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
    logDragEvent("Column drag started", { columnKey });
    this.dragController.startColumnDrag(evt, columnKey);
  }

  private endColumnDrag(): void {
    logDragEvent("Column drag ended");
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

    const orderedGroups = this.sortGroupsByColumnOrder(
      this.mergeGroupsByColumnKey(this.data?.groupedData ?? []),
    );
    const orderedKeys = orderedGroups.map((group) => getColumnKey(group.key));
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
    // this.render(); commented out for debugging rendering
  }

  private handleColumnScroll(columnKey: string, scrollTop: number): void {
    // Save column scroll position for partial render restoration
    saveColumnScrollPosition(this.viewSessionId, columnKey, scrollTop);
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

    const cardEls =
      this.rootEl.querySelectorAll<HTMLElement>(".bases-kanban-card");
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
      logDragEvent("Drop aborted - missing property or source", {
        hasGroupByProperty: groupByProperty !== null,
        hasDraggingSource: draggingSourcePath !== null,
      });
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

    if (sourceColumnKey === targetColumnKey) {
      logDragEvent("Same column drop - skipping render (rely on reactivity)");
    } else {
      logDragEvent("Cross-column drop - expecting re-render from data update");
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
