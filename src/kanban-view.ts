import {
  App,
  BasesEntry,
  BasesEntryGroup,
  type BasesPropertyId,
  BasesView,
  Menu,
  Modal,
  Notice,
  normalizePath,
  QueryController,
  setIcon,
  SuggestModal,
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
  COLUMNS_RIGHT_TO_LEFT_OPTION_KEY,
  COLUMN_TRANSPARENCY_OPTION_KEY,
  LOCAL_CARD_ORDER_OPTION_KEY,
  NO_VALUE_COLUMN_KEY,
  PINNED_COLUMNS_OPTION_KEY,
} from "./kanban-view/constants";
import { getKanbanViewOptions } from "./kanban-view/options";
import {
  detectGroupByProperty,
  getColumnKey,
  getTargetGroupValue,
  getPropertyValues,
  getPropertyCandidates,
  getSelectedProperties,
  getWritablePropertyKey,
  hasConfiguredGroupBy,
  isSameGroupValue,
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
import type {
  KanbanCallbacks,
  PropertyEditorMode,
  PropertyType,
} from "./kanban-view/actions";

type MetadataPropertyInfo = {
  options?: Record<string, string> | string[];
  type?: string;
  widget?: string;
};

type MetadataTypeManagerLike = {
  getPropertyInfo: (name: string) => MetadataPropertyInfo | undefined;
};

type AppWithMetadataTypeManager = App & {
  metadataTypeManager?: MetadataTypeManagerLike;
};

type BackgroundImageSourceOption = "local" | "remote";

const BACKGROUND_IMAGE_FILE_EXTENSIONS = new Set<string>([
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

class BackgroundImageSourceSuggestModal extends SuggestModal<BackgroundImageSourceOption> {
  private readonly options: Record<BackgroundImageSourceOption, string> = {
    local: "Vault image",
    remote: "Remote image URL",
  };

  constructor(
    app: App,
    private readonly currentInput: string,
    private readonly chooseLocal: () => void,
    private readonly chooseRemote: () => void,
  ) {
    super(app);
    this.setPlaceholder("Choose background image source");
  }

  getSuggestions(query: string): BackgroundImageSourceOption[] {
    const normalizedQuery = query.toLowerCase();
    return (Object.keys(this.options) as BackgroundImageSourceOption[]).filter(
      (key) => this.options[key].toLowerCase().includes(normalizedQuery),
    );
  }

  renderSuggestion(value: BackgroundImageSourceOption, el: HTMLElement): void {
    const rowEl = el.createDiv({ cls: "suggestion-content" });
    const titleEl = rowEl.createDiv({ cls: "suggestion-title" });

    const sourceIconEl = titleEl.createSpan({ cls: "suggestion-flair" });
    setIcon(sourceIconEl, value === "local" ? "image" : "globe");
    titleEl.appendText(" ");

    titleEl.createSpan({ text: this.options[value] });

    const currentSource = this.getCurrentSource();
    if (currentSource !== value) {
      return;
    }

    const statusEl = rowEl.createDiv({
      cls: "bases-kanban-background-image-suggestion-path",
    });
    const checkEl = statusEl.createSpan({ cls: "suggestion-flair" });
    setIcon(checkEl, "check");
    statusEl.createSpan({ text: this.getCurrentLabel() });
  }

  onChooseSuggestion(value: BackgroundImageSourceOption): void {
    if (value === "local") {
      this.chooseLocal();
      return;
    }
    this.chooseRemote();
  }

  private getCurrentSource(): BackgroundImageSourceOption | null {
    if (this.currentInput.length === 0) {
      return null;
    }
    return /^https?:\/\//i.test(this.currentInput) ? "remote" : "local";
  }

  private getCurrentLabel(): string {
    if (this.currentInput.length === 0) {
      return "Current: none";
    }
    return `Current: ${this.currentInput}`;
  }
}

class LocalBackgroundImageSuggestModal extends SuggestModal<TFile> {
  private suggestions: TFile[] = [];
  private observer: MutationObserver | null = null;
  private didConfirm = false;
  private lastPreviewPath: string | null = null;

  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly currentInput: string,
    private readonly previewFile: (file: TFile) => void,
    private readonly chooseFile: (file: TFile) => void,
    private readonly cancel: () => void,
  ) {
    super(app);
    this.setPlaceholder("Type to search vault images");
  }

  onOpen(): void {
    super.onOpen();
    this.observer = new MutationObserver(() => {
      this.updatePreviewFromActiveSuggestion();
    });
    this.observer.observe(this.resultContainerEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    window.requestAnimationFrame(() => {
      this.updatePreviewFromActiveSuggestion();
    });
  }

  onClose(): void {
    this.observer?.disconnect();
    this.observer = null;
    super.onClose();

    if (!this.didConfirm) {
      this.cancel();
    }
  }

  getSuggestions(query: string): TFile[] {
    const normalizedQuery = query.trim().toLowerCase();
    this.suggestions =
      normalizedQuery.length === 0
        ? this.files
        : this.files.filter((file) => {
            return (
              file.path.toLowerCase().includes(normalizedQuery) ||
              file.basename.toLowerCase().includes(normalizedQuery)
            );
          });

    return this.suggestions;
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    const titleEl = el.createDiv({
      cls: "bases-kanban-background-image-suggestion-path",
    });
    if (file.path === this.currentInput) {
      const currentEl = titleEl.createSpan({ cls: "suggestion-flair" });
      setIcon(currentEl, "check");
      titleEl.appendText(" ");
    }
    titleEl.appendText(file.path);
  }

  onChooseSuggestion(file: TFile): void {
    this.didConfirm = true;
    this.lastPreviewPath = file.path;
    this.chooseFile(file);
  }

  private updatePreviewFromActiveSuggestion(): void {
    const selectedEl = this.resultContainerEl.querySelector(
      ".suggestion-item.is-selected",
    );
    if (!(selectedEl instanceof HTMLElement)) {
      return;
    }

    const allItems = Array.from(
      this.resultContainerEl.querySelectorAll(".suggestion-item"),
    );
    const selectedIndex = allItems.indexOf(selectedEl);
    if (selectedIndex < 0 || selectedIndex >= this.suggestions.length) {
      return;
    }

    const selectedFile = this.suggestions[selectedIndex];
    if (selectedFile.path === this.lastPreviewPath) {
      return;
    }

    this.lastPreviewPath = selectedFile.path;
    this.previewFile(selectedFile);
  }
}

function isBackgroundImageFile(file: TFile): boolean {
  return BACKGROUND_IMAGE_FILE_EXTENSIONS.has(file.extension.toLowerCase());
}

export class KanbanView extends BasesView {
  type = "cumban";
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
  private columnsRightToLeft = false;
  private currentRenderedGroups: RenderedGroup[] = [];
  private incrementalLoadRafId: number | null = null;

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

  requestAddColumn(): void {
    this.promptAndAddPinnedEmptyColumn();
  }

  isRenderedWithin(containerEl: HTMLElement): boolean {
    return containerEl.contains(this.rootEl);
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
    const columnsRightToLeft = this.getColumnsRightToLeftFromConfig();

    if (renderedGroups.length > 0) {
      const firstColumn = renderedGroups[0];
      const columnKey = getColumnKey(firstColumn.group.key);
      logRenderEvent("First column entries", {
        columnKey,
        entryCount: firstColumn.entries.length,
        firstPaths: firstColumn.entries.slice(0, 3).map((e) => e.file.path),
      });
    }

    this.currentRenderedGroups = renderedGroups;

    this.refreshEntryIndexes(renderedGroups);
    this.updateSvelteProps();

    const selectedProperties = getSelectedProperties(this.data?.properties);
    const groupByProperty = detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(selectedProperties, this.allProperties),
    );

    if (this.svelteApp === null) {
      logRenderEvent("Mounting Svelte app for first render");
      const shellGroups: RenderedGroup[] = renderedGroups.map((rg) => ({
        group: rg.group,
        entries: [],
      }));
      this.mountSvelteApp(
        shellGroups,
        groupByProperty,
        selectedProperties,
        columnsRightToLeft,
      );
      this.scheduleIncrementalCardLoad(
        renderedGroups,
        groupByProperty,
        selectedProperties,
      );
    } else {
      if (this.columnsRightToLeft !== columnsRightToLeft) {
        this.unmountSvelteApp();
        this.rootEl.empty();
        this.mountSvelteApp(
          renderedGroups,
          groupByProperty,
          selectedProperties,
          columnsRightToLeft,
        );
        this.viewModel.setAnimationsReady(true);
        logRenderEvent("Remounted Svelte app for columns direction change", {
          columnsRightToLeft,
        });
        return;
      }
      this.cancelIncrementalLoad();
      this.viewModel.setAnimationsReady(true);
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
    columnsRightToLeft: boolean,
  ): void {
    const initialBoardScroll = this.getInitialBoardScroll();
    const columnScrollByKey: Record<string, number> = {};
    for (const { group } of renderedGroups) {
      const columnKey = getColumnKey(group.key);
      columnScrollByKey[columnKey] = loadColumnScrollPosition(
        this.viewSessionId,
        columnKey,
      );
    }

    this.viewModel.setBoardData({
      groups: renderedGroups,
      groupByProperty,
      selectedProperties,
    });
    this.viewModel.setColumnScrollByKey(columnScrollByKey);
    this.viewModel.setPinnedColumns(new Set(this.getPinnedColumnsFromConfig()));

    const callbacks: KanbanCallbacks = {
      card: {
        select: (filePath: string, extendSelection: boolean) =>
          this.selectCard(filePath, extendSelection),
        dragStart: (filePath: string, cardIndex: number) =>
          this.startCardDrag(filePath, cardIndex),
        dragEnd: () => this.endCardDrag(),
        drop: (
          sourcePath: string | null,
          filePath: string | null,
          grpKey: unknown,
          placement: "before" | "after",
        ) => this.handleCardDrop(sourcePath, filePath, grpKey, placement),
        contextMenu: (evt: MouseEvent, entry: BasesEntry) =>
          this.showCardContextMenu(evt, entry.file),
        linkClick: (evt: MouseEvent, target: string) =>
          this.handleCardLinkClick(evt, target),
        rename: (filePath: string, nextTitle: string) =>
          this.renameCard(filePath, nextTitle),
        getPropertyEditorMode: (propertyId: BasesPropertyId) =>
          this.getPropertyEditorMode(propertyId),
        getPropertyType: (propertyId: BasesPropertyId) =>
          this.getPropertyType(propertyId),
        getPropertyCheckboxState: (
          filePath: string,
          propertyId: BasesPropertyId,
        ) => this.getPropertyCheckboxState(filePath, propertyId),
        getPropertySuggestions: (propertyId: BasesPropertyId) =>
          this.getPropertySuggestions(propertyId),
        updatePropertyValues: (
          filePath: string,
          propertyId: BasesPropertyId,
          mode: PropertyEditorMode,
          values: string[],
        ) => this.updateCardPropertyValues(filePath, propertyId, mode, values),
        updatePropertyCheckbox: (
          filePath: string,
          propertyId: BasesPropertyId,
          checked: boolean,
        ) => this.updateCardPropertyCheckbox(filePath, propertyId, checked),
      },
      column: {
        createCard: (grpByProperty: BasesPropertyId | null, grpKey: unknown) =>
          void this.createCardForColumn(grpByProperty, grpKey),
        rename: (columnKey: string, grpKey: unknown, nextName: string) =>
          this.renameColumn(columnKey, grpKey, nextName),
        startDrag: (columnKey: string) => this.startColumnDrag(columnKey),
        endDrag: () => this.endColumnDrag(),
        drop: (
          sourceKey: string | null,
          targetKey: string,
          placement: "before" | "after",
        ) => this.handleColumnDrop(sourceKey, targetKey, placement),
        togglePin: (columnKey: string) => this.toggleColumnPin(columnKey),
        cardsScroll: (columnKey: string, scrollTop: number) =>
          this.handleColumnScroll(columnKey, scrollTop),
      },
      board: {
        scroll: (scrollLeft: number, scrollTop: number) =>
          this.debouncedSaveBoardScrollPosition(scrollLeft, scrollTop),
        keyDown: (evt: KeyboardEvent) => this.handleKeyDown(evt),
        click: () => this.clearSelection(),
        addColumn: () => this.promptAndAddPinnedEmptyColumn(),
      },
    };

    this.svelteApp = mount(KanbanRoot, {
      target: this.rootEl,
      props: {
        app: this.app as App,
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
        columnsRightToLeft,
        groupsStore: this.viewModel.groupsStore,
        groupByPropertyStore: this.viewModel.groupByPropertyStore,
        selectedPropertiesStore: this.viewModel.selectedPropertiesStore,
        columnScrollByKeyStore: this.viewModel.columnScrollByKeyStore,
        pinnedColumnsStore: this.viewModel.pinnedColumnsStore,
        animationsReadyStore: this.viewModel.animationsReadyStore,
        callbacks,
      },
    });
    this.columnsRightToLeft = columnsRightToLeft;

    this.applyBackgroundStyles();
  }

  private updateSvelteAppProps(
    renderedGroups: RenderedGroup[],
    groupByProperty: BasesPropertyId | null,
    selectedProperties: BasesPropertyId[],
  ): void {
    const currentScrollByKey = this.viewModel.getColumnScrollByKey();
    const columnScrollByKey: Record<string, number> = {};
    let hasNewColumns = false;

    for (const { group } of renderedGroups) {
      const columnKey = getColumnKey(group.key);
      if (columnKey in currentScrollByKey) {
        columnScrollByKey[columnKey] = currentScrollByKey[columnKey]!;
      } else {
        columnScrollByKey[columnKey] = loadColumnScrollPosition(
          this.viewSessionId,
          columnKey,
        );
        hasNewColumns = true;
      }
    }

    this.viewModel.groupsStore.set(renderedGroups);
    this.viewModel.groupByPropertyStore.set(groupByProperty);
    this.viewModel.selectedPropertiesStore.set(selectedProperties);

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

  openBackgroundImagePicker(): void {
    const currentInput = this.getBackgroundImageInput();
    const modal = new BackgroundImageSourceSuggestModal(
      this.app as App,
      currentInput,
      () => this.openLocalBackgroundImagePicker(),
      () => {
        void this.openRemoteBackgroundImagePicker();
      },
    );
    modal.open();
  }

  private openLocalBackgroundImagePicker(): void {
    const previousInput = this.getBackgroundImageInput();
    const imageFiles = this.app.vault
      .getFiles()
      .filter((file) => isBackgroundImageFile(file))
      .sort((left, right) => left.path.localeCompare(right.path));

    if (imageFiles.length === 0) {
      new Notice("No image files found in the vault.");
      return;
    }

    const modal = new LocalBackgroundImageSuggestModal(
      this.app as App,
      imageFiles,
      previousInput,
      (file) => {
        this.setBackgroundImageInput(file.path);
      },
      (file) => {
        this.setBackgroundImageInput(file.path);
      },
      () => {
        this.setBackgroundImageInput(previousInput);
      },
    );
    modal.open();
  }

  private async openRemoteBackgroundImagePicker(): Promise<void> {
    const currentInput = this.getBackgroundImageInput();
    const currentValue = /^https?:\/\//i.test(currentInput.trim())
      ? currentInput
      : "";
    const nextValue = await this.openBackgroundImageUrlModal(currentValue);
    if (nextValue === null) {
      return;
    }
    this.setBackgroundImageInput(nextValue);
  }

  private openBackgroundImageUrlModal(
    currentValue: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app as App);
      let resolved = false;

      const finish = (value: string | null): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve(value);
      };

      modal.titleEl.setText("Set background image URL");

      const inputEl = modal.contentEl.createEl("input", {
        type: "text",
        value: currentValue,
        placeholder: "https://example.com/image.png",
      });
      inputEl.setCssProps({ width: "100%", "margin-bottom": "12px" });

      const buttonContainer = modal.contentEl.createDiv({
        cls: "modal-button-container",
      });

      const cancelButton = buttonContainer.createEl("button", {
        text: this.plugin.settings.cancelButtonText,
        cls: "mod-secondary",
      });
      cancelButton.addEventListener("click", () => {
        modal.close();
      });

      const saveButton = buttonContainer.createEl("button", {
        text: "Save",
        cls: "mod-cta",
      });

      const submit = (): void => {
        finish(inputEl.value.trim());
        modal.close();
      };

      saveButton.addEventListener("click", submit);
      inputEl.addEventListener("keydown", (evt) => {
        if (evt.key !== "Enter") {
          return;
        }
        evt.preventDefault();
        submit();
      });

      modal.onOpen = () => {
        inputEl.focus();
        inputEl.select();
      };

      modal.onClose = () => {
        modal.contentEl.empty();
        finish(null);
      };

      modal.open();
    });
  }

  private setBackgroundImageInput(input: string): void {
    this.config?.set(BACKGROUND_IMAGE_OPTION_KEY, input);
    this.applyBackgroundStyles();
  }

  private getBackgroundImageInput(): string {
    const value = this.config?.get(BACKGROUND_IMAGE_OPTION_KEY);
    return typeof value === "string" ? value : "";
  }

  private applyBackgroundStyles(): void {
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

    const styles = resolveBackgroundStyles(this.app as App, config);

    this.rootEl.style.setProperty(
      "--bases-kanban-column-transparency",
      String(styles.columnTransparencyValue),
    );

    this.rootEl.style.setProperty(
      "--bases-kanban-column-blur",
      `${styles.columnBlurValue}px`,
    );

    const backgroundEl = this.rootEl.querySelector<HTMLDivElement>(
      ".bases-kanban-background",
    );
    if (backgroundEl !== null) {
      backgroundEl.style.display = styles.hasImage ? "block" : "none";
      backgroundEl.style.backgroundImage =
        styles.imageUrl === null ? "none" : `url("${styles.imageUrl}")`;
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

  private async renameCard(filePath: string, nextTitle: string): Promise<void> {
    const trimmedTitle = nextTitle.trim();
    if (trimmedTitle.length === 0) {
      return;
    }

    const entry = this.entryByPath.get(filePath);
    if (entry === undefined) {
      return;
    }

    const file = entry.file;
    if (trimmedTitle === file.basename) {
      return;
    }

    const parentPath = file.parent?.path ?? "";
    const nextFilePath = normalizePath(
      parentPath.length === 0
        ? `${trimmedTitle}.${file.extension}`
        : `${parentPath}/${trimmedTitle}.${file.extension}`,
    );

    await this.app.fileManager.renameFile(file, nextFilePath);
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

  private getPropertyEditorMode(
    propertyId: BasesPropertyId,
  ): PropertyEditorMode | null {
    const propertyName = this.getNotePropertyName(propertyId);
    if (propertyName === null) {
      return null;
    }

    const metadataTypeManager = (this.app as AppWithMetadataTypeManager)
      .metadataTypeManager;
    const propertyInfo = metadataTypeManager?.getPropertyInfo(
      propertyName.toLowerCase(),
    );
    const widgetType = propertyInfo?.widget ?? propertyInfo?.type ?? "";

    if (
      widgetType === "multitext" ||
      widgetType === "aliases" ||
      widgetType === "tags"
    ) {
      return "multi";
    }

    if (widgetType === "dropdown" || widgetType === "select") {
      return "single";
    }

    if (widgetType === "text" || widgetType === "") {
      return "single";
    }

    if (propertyName === "tags") {
      return "multi";
    }

    return null;
  }

  private getPropertyType(propertyId: BasesPropertyId): PropertyType {
    const propertyName = this.getNotePropertyName(propertyId);
    if (propertyName === null) {
      return "unknown";
    }

    const metadataTypeManager = (this.app as AppWithMetadataTypeManager)
      .metadataTypeManager;
    const propertyInfo = metadataTypeManager?.getPropertyInfo(
      propertyName.toLowerCase(),
    );
    const widgetType = propertyInfo?.widget ?? propertyInfo?.type ?? "";

    if (widgetType === "date") {
      return "date";
    }
    if (widgetType === "datetime") {
      return "datetime";
    }
    if (widgetType === "time") {
      return "time";
    }
    if (widgetType === "multitext" || widgetType === "aliases") {
      return "multitext";
    }
    if (widgetType === "tags") {
      return "tags";
    }
    if (widgetType === "checkbox") {
      return "checkbox";
    }
    if (widgetType === "number") {
      return "number";
    }
    if (widgetType === "dropdown" || widgetType === "select") {
      return "select";
    }
    if (widgetType === "text") {
      return "text";
    }

    return "unknown";
  }

  private getPropertySuggestions(propertyId: BasesPropertyId): string[] {
    const propertyName = this.getNotePropertyName(propertyId);
    if (propertyName === null) {
      return [];
    }

    const propertyKey = getWritablePropertyKey(propertyId);
    if (propertyKey === null) {
      return [];
    }

    const metadataTypeManager = (this.app as AppWithMetadataTypeManager)
      .metadataTypeManager;
    const propertyInfo = metadataTypeManager?.getPropertyInfo(
      propertyName.toLowerCase(),
    );

    const suggestions = new Set<string>();
    const options = propertyInfo?.options;
    if (Array.isArray(options)) {
      for (const option of options) {
        const trimmed = option.trim();
        if (trimmed.length > 0) {
          suggestions.add(trimmed);
        }
      }
    } else if (options !== undefined) {
      for (const option of Object.values(options)) {
        const trimmed = option.trim();
        if (trimmed.length > 0) {
          suggestions.add(trimmed);
        }
      }
    }

    for (const entry of this.entryByPath.values()) {
      const values = getPropertyValues(entry.getValue(propertyId));
      if (values === null) {
        continue;
      }
      for (const value of values) {
        suggestions.add(value);
      }
    }

    const markdownFiles = this.app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (frontmatter === undefined) {
        continue;
      }

      const value = this.getFrontmatterPropertyValue(
        frontmatter,
        propertyId,
        propertyKey,
      );
      this.collectSuggestionValues(value, suggestions);
    }

    return Array.from(suggestions).sort((a, b) => a.localeCompare(b));
  }

  private getPropertyCheckboxState(
    filePath: string,
    propertyId: BasesPropertyId,
  ): boolean {
    const entry = this.entryByPath.get(filePath);
    if (entry === undefined) {
      return false;
    }
    return this.isCheckboxValueChecked(entry.getValue(propertyId));
  }

  private isCheckboxValueChecked(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === "true" ||
        normalized === "1" ||
        normalized === "yes" ||
        normalized === "on" ||
        normalized === "checked"
      );
    }

    if (typeof value === "object" && value !== null) {
      if ("data" in value) {
        return this.isCheckboxValueChecked(value.data);
      }
    }

    return false;
  }

  private getFrontmatterPropertyValue(
    frontmatter: Record<string, unknown>,
    propertyId: BasesPropertyId,
    propertyKey: string,
  ): unknown {
    if (Object.prototype.hasOwnProperty.call(frontmatter, propertyId)) {
      return frontmatter[propertyId];
    }
    return frontmatter[propertyKey];
  }

  private collectSuggestionValues(
    value: unknown,
    suggestions: Set<string>,
  ): void {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const part of value) {
        const text = String(part).trim();
        if (text.length > 0) {
          suggestions.add(text);
        }
      }
      return;
    }

    const text = String(value).trim();
    if (text.length === 0) {
      return;
    }

    if (!text.includes(",")) {
      suggestions.add(text);
      return;
    }

    const parts = text
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const part of parts) {
      suggestions.add(part);
    }
  }

  private async updateCardPropertyValues(
    filePath: string,
    propertyId: BasesPropertyId,
    mode: PropertyEditorMode,
    values: string[],
  ): Promise<void> {
    const propertyKey = getWritablePropertyKey(propertyId);
    if (propertyKey === null) {
      return;
    }

    const entry = this.entryByPath.get(filePath);
    if (entry === undefined) {
      return;
    }

    await this.mutationService.updateCardPropertyValues({
      file: entry.file,
      propertyId,
      propertyKey,
      mode,
      values,
    });
  }

  private async updateCardPropertyCheckbox(
    filePath: string,
    propertyId: BasesPropertyId,
    checked: boolean,
  ): Promise<void> {
    const propertyKey = getWritablePropertyKey(propertyId);
    if (propertyKey === null) {
      return;
    }

    const entry = this.entryByPath.get(filePath);
    if (entry === undefined) {
      return;
    }

    await this.mutationService.updateCardPropertyCheckbox({
      file: entry.file,
      propertyId,
      propertyKey,
      checked,
    });
  }

  private getNotePropertyName(propertyId: BasesPropertyId): string | null {
    if (!propertyId.startsWith("note.")) {
      return null;
    }
    return propertyId.slice("note.".length);
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
          cls: "mod-cta bases-kanban-trash-confirm-button",
        });
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
        await this.app.fileManager.trashFile(file);
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
    } else if (placement === "before") {
      insertionIndex = 0;
    }

    nextPaths.splice(insertionIndex, 0, ...movedPaths);
    return nextPaths;
  }

  private getColumnCardPaths(columnKey: string): string[] {
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
    this.viewModel.setSelectedPaths(this.selectionState.selectedPaths);
  }

  private startCardDrag(filePath: string, cardIndex: number): void {
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

    const orderedKeys = this.currentRenderedGroups.map(({ group }) =>
      getColumnKey(group.key),
    );
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

  private getColumnsRightToLeftFromConfig(): boolean {
    return this.config?.get(COLUMNS_RIGHT_TO_LEFT_OPTION_KEY) === true;
  }

  private updatePinnedColumns(pinnedColumns: string[]): void {
    this.pinnedColumnsCache = { columns: null, raw: "" };
    this.config?.set(
      PINNED_COLUMNS_OPTION_KEY,
      serializePinnedColumns(pinnedColumns),
    );
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

  private async renameColumn(
    columnKey: string,
    groupKey: unknown,
    nextName: string,
  ): Promise<void> {
    const trimmedNextName = nextName.trim();
    if (trimmedNextName.length === 0) {
      return;
    }

    const currentGroupValue = getTargetGroupValue(groupKey);
    if (currentGroupValue === trimmedNextName) {
      return;
    }

    const groupByProperty = this.getActiveGroupByProperty();
    if (groupByProperty === null) {
      return;
    }

    const groupByPropertyKey = getWritablePropertyKey(groupByProperty);
    if (groupByPropertyKey === null) {
      return;
    }

    const columnEntries = this.getEntriesForColumn(columnKey);
    if (columnEntries.length > 0) {
      const confirmed = await this.openRenameColumnConfirmModal(
        columnKey,
        trimmedNextName,
        columnEntries.length,
      );
      if (!confirmed) {
        return;
      }
    }

    for (const entry of columnEntries) {
      await this.mutationService.updateCardPropertyValues({
        file: entry.file,
        propertyId: groupByProperty,
        propertyKey: groupByPropertyKey,
        mode: "single",
        values: [trimmedNextName],
      });
    }

    this.renamePinnedColumnKey(columnKey, trimmedNextName);
    this.renameColumnOrderKey(columnKey, trimmedNextName);
    this.renameLocalCardOrderColumnKey(columnKey, trimmedNextName);
  }

  private getActiveGroupByProperty(): BasesPropertyId | null {
    const rawGroups: BasesEntryGroup[] = this.data?.groupedData ?? [];
    return detectGroupByProperty(
      rawGroups,
      getPropertyCandidates(
        getSelectedProperties(this.data?.properties),
        this.allProperties,
      ),
    );
  }

  private getEntriesForColumn(columnKey: string): BasesEntry[] {
    const renderedGroup = this.currentRenderedGroups.find(({ group }) => {
      return getColumnKey(group.key) === columnKey;
    });
    return renderedGroup?.entries ?? [];
  }

  private renamePinnedColumnKey(
    oldColumnKey: string,
    newColumnKey: string,
  ): void {
    if (oldColumnKey === newColumnKey) {
      return;
    }

    const currentPinned = this.getPinnedColumnsFromConfig();
    if (!currentPinned.includes(oldColumnKey)) {
      return;
    }

    const nextPinned = currentPinned.map((columnKey) => {
      return columnKey === oldColumnKey ? newColumnKey : columnKey;
    });
    this.updatePinnedColumns([...new Set(nextPinned)]);
  }

  private renameColumnOrderKey(
    oldColumnKey: string,
    newColumnKey: string,
  ): void {
    if (oldColumnKey === newColumnKey) {
      return;
    }

    const currentOrder = this.getColumnOrderFromConfig();
    if (!currentOrder.includes(oldColumnKey)) {
      return;
    }

    const nextOrder = currentOrder.map((columnKey) => {
      return columnKey === oldColumnKey ? newColumnKey : columnKey;
    });
    this.updateColumnOrder(nextOrder);
  }

  private renameLocalCardOrderColumnKey(
    oldColumnKey: string,
    newColumnKey: string,
  ): void {
    if (oldColumnKey === newColumnKey) {
      return;
    }

    const localOrderByColumn = this.getLocalCardOrderByColumn();
    const existingOrder = localOrderByColumn.get(oldColumnKey);
    if (existingOrder === undefined) {
      return;
    }

    localOrderByColumn.delete(oldColumnKey);
    localOrderByColumn.set(newColumnKey, existingOrder);
    this.setLocalCardOrderByColumn(localOrderByColumn);
  }

  private openRenameColumnConfirmModal(
    currentColumnName: string,
    nextColumnName: string,
    cardCount: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app as App);
      let resolved = false;

      const finish = (value: boolean): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve(value);
      };

      modal.titleEl.setText(`Rename column to "${nextColumnName}"?`);
      modal.contentEl.createEl("p", {
        text:
          cardCount === 1
            ? `This will update 1 card from "${currentColumnName}" to "${nextColumnName}".`
            : `This will update ${cardCount} cards from "${currentColumnName}" to "${nextColumnName}".`,
      });

      const buttonContainer = modal.contentEl.createDiv({
        cls: "modal-button-container",
      });

      const cancelButton = buttonContainer.createEl("button", {
        text: this.plugin.settings.cancelButtonText,
        cls: "mod-secondary",
      });
      cancelButton.addEventListener("click", () => {
        finish(false);
        modal.close();
      });

      const confirmButton = buttonContainer.createEl("button", {
        text: "Rename",
        cls: "mod-cta",
      });
      confirmButton.addEventListener("click", () => {
        finish(true);
        modal.close();
      });

      modal.onClose = () => {
        modal.contentEl.empty();
        finish(false);
      };

      modal.open();
    });
  }

  private promptAndAddPinnedEmptyColumn(): void {
    const defaultColumnName = this.getUniqueColumnKey("New column");
    void this.openNewColumnNameModal(defaultColumnName).then((columnName) => {
      if (columnName === null) {
        return;
      }
      this.addPinnedEmptyColumn(columnName);
    });
  }

  private openNewColumnNameModal(
    defaultColumnName: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app as App);
      let resolved = false;

      const finish = (value: string | null): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve(value);
      };

      modal.titleEl.setText("New column");

      const inputEl = modal.contentEl.createEl("input", {
        type: "text",
        value: defaultColumnName,
      });
      inputEl.setCssProps({ width: "100%", "margin-bottom": "12px" });

      const buttonContainer = modal.contentEl.createDiv({
        cls: "modal-button-container",
      });

      const cancelButton = buttonContainer.createEl("button", {
        text: this.plugin.settings.cancelButtonText,
        cls: "mod-secondary",
      });
      cancelButton.addEventListener("click", () => {
        modal.close();
      });

      const createButton = buttonContainer.createEl("button", {
        text: "Create",
        cls: "mod-cta",
      });

      const submit = (): void => {
        const requestedName = inputEl.value.trim();
        finish(requestedName.length > 0 ? requestedName : defaultColumnName);
        modal.close();
      };

      createButton.addEventListener("click", submit);
      inputEl.addEventListener("keydown", (evt) => {
        if (evt.key !== "Enter") {
          return;
        }
        evt.preventDefault();
        submit();
      });

      modal.onOpen = () => {
        inputEl.focus();
        inputEl.select();
      };

      modal.onClose = () => {
        modal.contentEl.empty();
        finish(null);
      };

      modal.open();
    });
  }

  private getUniqueColumnKey(baseColumnKey: string): string {
    const existingColumnKeys = new Set<string>(
      this.currentRenderedGroups.map(({ group }) => getColumnKey(group.key)),
    );
    for (const pinnedColumnKey of this.getPinnedColumnsFromConfig()) {
      existingColumnKeys.add(pinnedColumnKey);
    }

    let nextColumnKey = baseColumnKey;
    let suffix = 2;
    while (existingColumnKeys.has(nextColumnKey)) {
      nextColumnKey = `${baseColumnKey} ${suffix}`;
      suffix += 1;
    }

    return nextColumnKey;
  }

  private addPinnedEmptyColumn(baseColumnKey: string): void {
    const nextColumnKey = this.getUniqueColumnKey(baseColumnKey);

    const currentPinnedColumns = this.getPinnedColumnsFromConfig();
    this.updatePinnedColumns([...currentPinnedColumns, nextColumnKey]);

    const currentColumnOrder = this.getColumnOrderFromConfig();
    if (
      currentColumnOrder.length > 0 &&
      !currentColumnOrder.includes(nextColumnKey)
    ) {
      this.updateColumnOrder([...currentColumnOrder, nextColumnKey]);
    }

    logDebug("PIN", `Added pinned empty column ${nextColumnKey}`);
    this.render();
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

    const targetGroupValue = getTargetGroupValue(groupKey);
    const hasGroupMutation = draggedPaths.some((path) => {
      const entry = this.entryByPath.get(path);
      if (entry === undefined) {
        return false;
      }
      return !isSameGroupValue(
        entry.getValue(groupByProperty),
        targetGroupValue,
      );
    });

    await this.mutationService.handleDrop({
      groupByProperty,
      groupByPropertyKey: getWritablePropertyKey(groupByProperty),
      groupKey,
      draggedPaths,
      entryByPath: this.entryByPath,
    });

    this.viewModel.endCardDrag();

    // Only force render when no group mutation occurred.
    // Cross-column moves trigger onDataUpdated(), so forcing render here can cause
    // an extra render with stale group data before the authoritative data update.
    if (!hasGroupMutation) {
      logDragEvent("Triggering render after drop");
      this.render();
    }
  }

  private debouncedSaveBoardScrollPosition(
    scrollLeft: number,
    scrollTop: number,
  ): void {
    const configAtSchedule = this.config;
    const sessionIdAtSchedule = this.viewSessionId;

    logScrollEvent("Debounced scroll save triggered", {
      scrollLeft,
      scrollTop,
      sessionId: `${sessionIdAtSchedule.slice(0, 8)}...`,
    });
    if (this.scrollSaveTimeout !== null) {
      window.clearTimeout(this.scrollSaveTimeout);
    }
    this.scrollSaveTimeout = window.setTimeout(() => {
      const configChanged = this.config !== configAtSchedule;
      const sessionChanged = this.viewSessionId !== sessionIdAtSchedule;
      const viewUnavailable =
        this.svelteApp === null || !this.rootEl.isConnected;
      if (configChanged || sessionChanged || viewUnavailable) {
        logScrollEvent("Skipping stale debounced scroll save", {
          configChanged,
          sessionChanged,
          viewUnavailable,
          scheduledSessionId: `${sessionIdAtSchedule.slice(0, 8)}...`,
          currentSessionId: `${this.viewSessionId.slice(0, 8)}...`,
        });
        this.scrollSaveTimeout = null;
        return;
      }

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

  private cancelIncrementalLoad(): void {
    if (this.incrementalLoadRafId !== null) {
      cancelAnimationFrame(this.incrementalLoadRafId);
      this.incrementalLoadRafId = null;
    }
  }

  private scheduleIncrementalCardLoad(
    renderedGroups: RenderedGroup[],
    groupByProperty: BasesPropertyId | null,
    selectedProperties: BasesPropertyId[],
  ): void {
    this.cancelIncrementalLoad();
    this.viewModel.setAnimationsReady(false);

    const CARDS_PER_BATCH = 100;
    const numColumns = renderedGroups.length;
    if (numColumns === 0) {
      return;
    }

    const perColumnBatch = Math.max(
      1,
      Math.ceil(CARDS_PER_BATCH / numColumns),
    );
    const revealed = new Array<number>(numColumns).fill(0);
    const totals = renderedGroups.map((g) => g.entries.length);

    const loadNextBatch = (): void => {
      let anyAdded = false;
      for (let i = 0; i < numColumns; i++) {
        const before = revealed[i];
        revealed[i] = Math.min(revealed[i]! + perColumnBatch, totals[i]!);
        if (revealed[i]! > before!) {
          anyAdded = true;
        }
      }

      if (!anyAdded) {
        this.incrementalLoadRafId = null;
        return;
      }

      const partialGroups: RenderedGroup[] = renderedGroups.map((rg, i) => ({
        group: rg.group,
        entries: rg.entries.slice(0, revealed[i]),
      }));

      this.viewModel.setBoardData({
        groups: partialGroups,
        groupByProperty,
        selectedProperties,
      });

      const allDone = revealed.every((r, i) => r >= totals[i]!);
      if (!allDone) {
        this.incrementalLoadRafId = requestAnimationFrame(loadNextBatch);
      } else {
        this.incrementalLoadRafId = null;
        this.viewModel.setAnimationsReady(true);
        logRenderEvent("Incremental card load complete");
      }
    };

    this.incrementalLoadRafId = requestAnimationFrame(loadNextBatch);
  }

  private unmountSvelteApp(): void {
    this.cancelIncrementalLoad();
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
