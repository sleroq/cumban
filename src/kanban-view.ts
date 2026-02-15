import {
	BasesEntry,
	BasesEntryGroup,
	BasesPropertyId,
	BasesView,
	NullValue,
	QueryController,
} from "obsidian";

const NO_VALUE_COLUMN = "(No value)";
const NO_VALUE_COLUMN_KEY = "__bases_kanban_no_value__";
const COLUMN_ORDER_OPTION_KEY = "columnOrder";
const CARD_SORT_PROPERTY_OPTION_KEY = "cardSortProperty";
const DEFAULT_CARD_SORT_PROPERTY_ID = "note.kanban_order";
const GROUP_BY_PLACEHOLDER =
	'Set "Group by" in the sort menu to organize cards into columns.';

export class KanbanView extends BasesView {
type = "kanban";
private readonly rootEl: HTMLElement;
private selectedPaths = new Set<string>();
private cardOrder: string[] = [];
	private entryByPath = new Map<string, BasesEntry>();
	private lastSelectedIndex: number | null = null;
	private draggingSourcePath: string | null = null;
	private draggingColumnKey: string | null = null;
	private columnDropTargetKey: string | null = null;
	private columnDropPlacement: "before" | "after" | null = null;
	private cardDropTargetPath: string | null = null;
	private cardDropPlacement: "before" | "after" | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.rootEl = containerEl.createDiv({ cls: "bases-kanban-container" });
	}

	onDataUpdated(): void {
		this.render();
	}

	private render(): void {
		const previousBoardScrollLeft = this.getBoardScrollLeft();
		this.rootEl.empty();

		const groups: BasesEntryGroup[] = this.data?.groupedData ?? [];
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
			groups,
			getPropertyCandidates(selectedProperties, this.allProperties)
		);

		const boardEl = this.rootEl.createDiv({ cls: "bases-kanban-board" });
		let cardIndex = 0;
		for (const renderedGroup of renderedGroups) {
			cardIndex = this.renderColumn(
				boardEl,
				getColumnKey(renderedGroup.group.key),
				renderedGroup.group.key,
				renderedGroup.entries,
				selectedProperties,
				groupByProperty,
				cardIndex
			);
		}

		this.restoreBoardScrollLeft(previousBoardScrollLeft);
	}

	private getBoardScrollLeft(): number {
		const boardEl = this.rootEl.querySelector<HTMLElement>(".bases-kanban-board");
		if (boardEl === null) {
			return 0;
		}

		return boardEl.scrollLeft;
	}

	private restoreBoardScrollLeft(scrollLeft: number): void {
		if (scrollLeft <= 0) {
			return;
		}

		const boardEl = this.rootEl.querySelector<HTMLElement>(".bases-kanban-board");
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

	private renderColumn(
		boardEl: HTMLElement,
		columnKey: string,
		groupKey: unknown,
		entries: BasesEntry[],
		selectedProperties: BasesPropertyId[],
		groupByProperty: BasesPropertyId | null,
		startCardIndex: number
	): number {
		const columnName = getColumnName(groupKey);
		const columnEl = boardEl.createDiv({ cls: "bases-kanban-column" });
		columnEl.dataset.columnKey = columnKey;
		const headerEl = columnEl.createDiv({ cls: "bases-kanban-column-header" });
		headerEl.draggable = true;
		headerEl.addClass("bases-kanban-column-handle");
		headerEl.addEventListener("dragstart", (evt) => {
			this.startColumnDrag(evt, columnKey);
		});
		headerEl.addEventListener("dragend", () => {
			this.endColumnDrag();
		});

		columnEl.addEventListener("dragover", (evt) => {
			if (this.draggingColumnKey === null) {
				return;
			}

			evt.preventDefault();
			if (evt.dataTransfer !== null) {
				evt.dataTransfer.dropEffect = "move";
			}

			const rect = columnEl.getBoundingClientRect();
			const placement = evt.clientX < rect.left + rect.width / 2 ? "before" : "after";
			this.setColumnDropIndicator(columnKey, placement);
		});
		columnEl.addEventListener("dragleave", (evt) => {
			if (evt.relatedTarget instanceof Node && columnEl.contains(evt.relatedTarget)) {
				return;
			}

			if (evt.relatedTarget === null) {
				return;
			}

			if (this.columnDropTargetKey === columnKey) {
				this.clearColumnDropIndicator();
			}
		});
		columnEl.addEventListener("drop", (evt) => {
			if (this.draggingColumnKey === null) {
				return;
			}

			evt.preventDefault();
			const placement = this.columnDropPlacement ?? "before";
			this.handleColumnDrop(columnKey, placement);
		});

		headerEl.createEl("h3", { text: columnName });
		headerEl.createEl("span", {
			text: String(entries.length),
			cls: "bases-kanban-column-count",
		});

		const cardsEl = columnEl.createDiv({ cls: "bases-kanban-cards" });
		cardsEl.addEventListener("dragover", (evt) => {
			if (groupByProperty === null || this.draggingSourcePath === null) {
				return;
			}

			evt.preventDefault();
			if (evt.dataTransfer !== null) {
				evt.dataTransfer.dropEffect = "move";
			}
			cardsEl.addClass("bases-kanban-drop-target");
			const dropTarget = getCardDropTargetFromColumn(cardsEl, evt.clientY);
			if (dropTarget === null) {
				this.clearCardDropIndicator();
				return;
			}

			this.setCardDropIndicator(dropTarget.path, dropTarget.placement);
		});
		cardsEl.addEventListener("dragleave", (evt) => {
			if (evt.relatedTarget instanceof Node && cardsEl.contains(evt.relatedTarget)) {
				return;
			}

			cardsEl.removeClass("bases-kanban-drop-target");
		});
		cardsEl.addEventListener("drop", (evt) => {
			evt.preventDefault();
			cardsEl.removeClass("bases-kanban-drop-target");
			const targetPath = this.cardDropTargetPath;
			const placement = this.cardDropPlacement ?? "after";
			this.clearCardDropIndicator();
			void this.handleDrop(groupByProperty, groupKey, targetPath, placement);
		});

		let cardIndex = startCardIndex;
		for (const entry of entries) {
			this.renderCard(
				cardsEl,
				entry,
				groupKey,
				selectedProperties,
				groupByProperty,
				cardIndex
			);
			cardIndex += 1;
		}

		return cardIndex;
	}

	private renderCard(
		cardsEl: HTMLElement,
		entry: BasesEntry,
		groupKey: unknown,
		selectedProperties: BasesPropertyId[],
		groupByProperty: BasesPropertyId | null,
		cardIndex: number
	): void {
		const title = entry.file.basename;
		const filePath = entry.file.path;
		const cardEl = cardsEl.createDiv({ cls: "bases-kanban-card" });
		cardEl.draggable = groupByProperty !== null;
		cardEl.dataset.cardPath = filePath;
		cardEl.toggleClass("bases-kanban-card-selected", this.selectedPaths.has(filePath));

		cardEl.addEventListener("click", (evt) => {
			if ((evt.target as HTMLElement).closest("a") !== null) {
				return;
			}

			this.selectCard(filePath, cardIndex, evt.shiftKey);
		});
		cardEl.addEventListener("dragstart", (evt) => {
			this.startDrag(evt, filePath, cardIndex);
		});
		cardEl.addEventListener("dragend", () => {
			this.endDrag();
		});
		cardEl.addEventListener("dragover", (evt) => {
			if (groupByProperty === null || this.draggingSourcePath === null) {
				return;
			}

			evt.preventDefault();
			evt.stopPropagation();
			if (evt.dataTransfer !== null) {
				evt.dataTransfer.dropEffect = "move";
			}

			const rect = cardEl.getBoundingClientRect();
			const placement = evt.clientY < rect.top + rect.height / 2 ? "before" : "after";
			this.setCardDropIndicator(filePath, placement);
		});
		cardEl.addEventListener("dragleave", (evt) => {
			if (evt.relatedTarget instanceof Node && cardEl.contains(evt.relatedTarget)) {
				return;
			}

			if (this.cardDropTargetPath === filePath) {
				this.clearCardDropIndicator();
			}
		});
		cardEl.addEventListener("drop", (evt) => {
			if (groupByProperty === null || this.draggingSourcePath === null) {
				return;
			}

			evt.preventDefault();
			evt.stopPropagation();
			const placement = this.cardDropPlacement ?? "after";
			this.clearCardDropIndicator();
			void this.handleDrop(groupByProperty, groupKey, filePath, placement);
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
				evt.ctrlKey || evt.metaKey
			);
		});

		const propertiesToDisplay = selectedProperties.filter(
			(propertyId) =>
				propertyId !== "file.name" && propertyId !== groupByProperty
		);

		if (propertiesToDisplay.length === 0) {
			return;
		}

		const propertiesEl = cardEl.createDiv({ cls: "bases-kanban-card-properties" });
		for (const propertyId of propertiesToDisplay) {
			const value = formatPropertyValue(entry.getValue(propertyId));
			if (value === null) {
				continue;
			}

			const rowEl = propertiesEl.createDiv({ cls: "bases-kanban-property-row" });
			const wikiLink = parseSingleWikiLink(value);
			if (wikiLink === null) {
				rowEl.createSpan({
					cls: "bases-kanban-property-value",
					text: value,
				});
				continue;
			}

			const linkEl = rowEl.createEl("a", {
				cls: "bases-kanban-property-value internal-link",
				text: wikiLink.display,
			});

			linkEl.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				void this.app.workspace.openLinkText(
					wikiLink.target,
					"",
					evt.ctrlKey || evt.metaKey
				);
			});
		}

		if (propertiesEl.childElementCount === 0) {
			propertiesEl.remove();
		}
	}

	private refreshEntryIndexes(groups: BasesEntryGroup[]): void {
		const nextEntryByPath = new Map<string, BasesEntry>();
		const nextCardOrder: string[] = [];

		for (const group of groups) {
			for (const entry of group.entries) {
				const path = entry.file.path;
				nextEntryByPath.set(path, entry);
				nextCardOrder.push(path);
			}
		}

		this.entryByPath = nextEntryByPath;
		this.cardOrder = nextCardOrder;
		this.selectedPaths = new Set(
			[...this.selectedPaths].filter((path) => nextEntryByPath.has(path))
		);

		if (this.selectedPaths.size === 0) {
			this.lastSelectedIndex = null;
		}
	}

	private refreshEntryIndexesFromRendered(
		renderedGroups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>
	): void {
		const nextEntryByPath = new Map<string, BasesEntry>();
		const nextCardOrder: string[] = [];

		for (const renderedGroup of renderedGroups) {
			for (const entry of renderedGroup.entries) {
				const path = entry.file.path;
				nextEntryByPath.set(path, entry);
				nextCardOrder.push(path);
			}
		}

		this.entryByPath = nextEntryByPath;
		this.cardOrder = nextCardOrder;
		this.selectedPaths = new Set(
			[...this.selectedPaths].filter((path) => nextEntryByPath.has(path))
		);

		if (this.selectedPaths.size === 0) {
			this.lastSelectedIndex = null;
		}
	}

	private selectCard(filePath: string, cardIndex: number, extendSelection: boolean): void {
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
		} else {
			this.selectedPaths = new Set([filePath]);
		}

		this.lastSelectedIndex = cardIndex;
		this.updateSelectionStyles();
	}

	private updateSelectionStyles(): void {
		const cardEls = this.rootEl.querySelectorAll<HTMLElement>(
			".bases-kanban-card"
		);

		cardEls.forEach((cardEl) => {
			const path = cardEl.dataset.cardPath;
			cardEl.toggleClass(
				"bases-kanban-card-selected",
				path !== undefined && this.selectedPaths.has(path)
			);
		});
	}

	private startDrag(
		evt: DragEvent,
		filePath: string,
		cardIndex: number
	): void {
		if (!this.selectedPaths.has(filePath)) {
			this.selectedPaths = new Set([filePath]);
			this.lastSelectedIndex = cardIndex;
			this.updateSelectionStyles();
		}

		this.draggingSourcePath = filePath;
		if (evt.dataTransfer !== null) {
			evt.dataTransfer.effectAllowed = "move";
			evt.dataTransfer.setData("text/plain", filePath);
		}

		const dragPaths = this.getDraggedPaths(filePath);
		for (const path of dragPaths) {
			const cardEl = this.getCardEl(path);
			cardEl?.addClass("bases-kanban-card-dragging");
		}
	}

	private endDrag(): void {
		this.draggingSourcePath = null;
		this.clearCardDropIndicator();

		const draggingCards = this.rootEl.querySelectorAll<HTMLElement>(
			".bases-kanban-card-dragging"
		);
		draggingCards.forEach((cardEl) => {
			cardEl.removeClass("bases-kanban-card-dragging");
		});

		const dropTargets = this.rootEl.querySelectorAll<HTMLElement>(
			".bases-kanban-drop-target"
		);
		dropTargets.forEach((cardsEl) => {
			cardsEl.removeClass("bases-kanban-drop-target");
		});
	}

	private setCardDropIndicator(
		targetPath: string,
		placement: "before" | "after"
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

		const cardEl = this.getCardEl(targetPath);
		if (cardEl === null) {
			return;
		}

		cardEl.addClass(
			placement === "before"
				? "bases-kanban-card-drop-before"
				: "bases-kanban-card-drop-after"
		);
	}

	private clearCardDropIndicator(): void {
		const indicators = this.rootEl.querySelectorAll<HTMLElement>(
			".bases-kanban-card-drop-before, .bases-kanban-card-drop-after"
		);
		indicators.forEach((cardEl) => {
			cardEl.removeClass("bases-kanban-card-drop-before");
			cardEl.removeClass("bases-kanban-card-drop-after");
		});
		this.cardDropTargetPath = null;
		this.cardDropPlacement = null;
	}

	private startColumnDrag(evt: DragEvent, columnKey: string): void {
		this.draggingColumnKey = columnKey;
		this.clearColumnDropIndicator();
		if (evt.dataTransfer !== null) {
			evt.dataTransfer.effectAllowed = "move";
			evt.dataTransfer.setData("text/plain", columnKey);
		}
	}

	private endColumnDrag(): void {
		this.draggingColumnKey = null;
		this.clearColumnDropIndicator();
	}

	private setColumnDropIndicator(
		columnKey: string,
		placement: "before" | "after"
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

		const columnEl = this.getColumnEl(columnKey);
		if (columnEl === null) {
			return;
		}

		columnEl.addClass(
			placement === "before"
				? "bases-kanban-column-drop-before"
				: "bases-kanban-column-drop-after"
		);
	}

	private clearColumnDropIndicator(): void {
		const indicators = this.rootEl.querySelectorAll<HTMLElement>(
			".bases-kanban-column-drop-before, .bases-kanban-column-drop-after"
		);
		indicators.forEach((columnEl) => {
			columnEl.removeClass("bases-kanban-column-drop-before");
			columnEl.removeClass("bases-kanban-column-drop-after");
		});
		this.columnDropTargetKey = null;
		this.columnDropPlacement = null;
	}

	private getColumnEl(columnKey: string): HTMLElement | null {
		const columns = this.rootEl.querySelectorAll<HTMLElement>(".bases-kanban-column");
		for (let index = 0; index < columns.length; index += 1) {
			const column = columns.item(index);
			if (column.dataset.columnKey === columnKey) {
				return column;
			}
		}

		return null;
	}

	private handleColumnDrop(
		targetColumnKey: string,
		placement: "before" | "after"
	): void {
		const sourceColumnKey = this.draggingColumnKey;
		this.endColumnDrag();
		if (sourceColumnKey === null || sourceColumnKey === targetColumnKey) {
			return;
		}

		const orderedGroups = this.sortGroupsByColumnOrder(this.data?.groupedData ?? []);
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

	private sortGroupsByColumnOrder(groups: BasesEntryGroup[]): BasesEntryGroup[] {
		const columnOrder = this.getColumnOrderFromConfig();
		if (columnOrder.length === 0) {
			return groups;
		}

		const orderMap = new Map(columnOrder.map((columnKey, index) => [columnKey, index]));
		return [...groups].sort((groupA, groupB) => {
			const indexA = orderMap.get(getColumnKey(groupA.key)) ?? Number.POSITIVE_INFINITY;
			const indexB = orderMap.get(getColumnKey(groupB.key)) ?? Number.POSITIVE_INFINITY;
			if (
				indexA === Number.POSITIVE_INFINITY &&
				indexB === Number.POSITIVE_INFINITY
			) {
				return 0;
			}

			return indexA - indexB;
		});
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
		const cards = this.rootEl.querySelectorAll<HTMLElement>(".bases-kanban-card");
		for (let index = 0; index < cards.length; index += 1) {
			const card = cards.item(index);
			if (card.dataset.cardPath === path) {
				return card;
			}
		}

		return null;
	}

	private async handleDrop(
		groupByProperty: BasesPropertyId | null,
		groupKey: unknown,
		targetPath: string | null,
		placement: "before" | "after"
	): Promise<void> {
		if (groupByProperty === null || this.draggingSourcePath === null) {
			return;
		}

		const propertyKey = getWritablePropertyKey(groupByProperty);
		if (propertyKey === null) {
			return;
		}

		const draggedPaths = this.getDraggedPaths(this.draggingSourcePath);
		const sourcePath = this.draggingSourcePath;
		const sourceEntry = this.entryByPath.get(sourcePath);
		const sourceColumnKey =
			sourceEntry === undefined
				? null
				: getColumnKey(sourceEntry.getValue(groupByProperty));
		const targetColumnKey = getColumnKey(groupKey);
		const targetValue = getTargetGroupValue(groupKey);
		for (const path of draggedPaths) {
			const entry = this.entryByPath.get(path);
			if (entry === undefined) {
				continue;
			}

			const currentValue = entry.getValue(groupByProperty);
			if (isSameGroupValue(currentValue, targetValue)) {
				continue;
			}

			await this.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
				const key = resolveFrontmatterKey(frontmatter, groupByProperty, propertyKey);
				if (targetValue === null) {
					delete frontmatter[key];
					return;
				}

				frontmatter[key] = targetValue;
			});
		}

		const sortConfig = this.getWritableCardSortConfig();
		if (sortConfig === null) {
			return;
		}

		if (targetPath !== null || sourceColumnKey === targetColumnKey) {
			const targetColumnPaths = this.getColumnCardPaths(targetColumnKey);
			const reorderedPaths = reorderPaths(
				targetColumnPaths,
				sourcePath,
				targetPath,
				placement
			);
			await this.writeCardSortOrder(reorderedPaths, sortConfig);
		}

		if (sourceColumnKey !== null && sourceColumnKey !== targetColumnKey) {
			const sourceColumnPaths = this.getColumnCardPaths(sourceColumnKey).filter(
				(path) => path !== sourcePath
			);
			await this.writeCardSortOrder(sourceColumnPaths, sortConfig);
		}
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
			CARD_SORT_PROPERTY_OPTION_KEY
		);
		const resolvedFallbackPropertyId =
			fallbackPropertyId ?? DEFAULT_CARD_SORT_PROPERTY_ID;
		const fallbackPropertyKey = getWritablePropertyKey(resolvedFallbackPropertyId);
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

	private async writeCardSortOrder(
		orderedPaths: string[],
		sortConfig: {
			propertyId: BasesPropertyId;
			propertyKey: string;
			direction: "ASC" | "DESC";
		}
	): Promise<void> {
		const total = orderedPaths.length;
		for (let index = 0; index < total; index += 1) {
			const path = orderedPaths[index];
			const entry = this.entryByPath.get(path);
			if (entry === undefined) {
				continue;
			}

			const rank =
				sortConfig.direction === "ASC" ? index + 1 : total - index;
			const currentRank = toFiniteNumber(entry.getValue(sortConfig.propertyId));
			if (currentRank !== null && currentRank === rank) {
				continue;
			}

			await this.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
				const key = resolveFrontmatterKey(
					frontmatter,
					sortConfig.propertyId,
					sortConfig.propertyKey
				);
				frontmatter[key] = rank;
			});
		}
	}

	static getViewOptions() {
		return [
			{
				key: CARD_SORT_PROPERTY_OPTION_KEY,
				displayName: "Card order property",
				type: "property" as const,
				placeholder: "Optional fallback for drag reorder",
				filter: (propertyId: BasesPropertyId) =>
					!propertyId.startsWith("file.") && !propertyId.startsWith("formula."),
			},
			{
				key: COLUMN_ORDER_OPTION_KEY,
				displayName: "Column order",
				type: "text" as const,
				default: "",
				placeholder: "Managed by drag and drop",
				shouldHide: () => true,
			},
		];
	}
}

function hasConfiguredGroupBy(
	groups: Array<{ key?: unknown }>
): boolean {
	return (
		groups.length > 1 ||
		(groups.length === 1 &&
			groups[0].key !== undefined &&
			!(groups[0].key instanceof NullValue))
	);
}

function getSelectedProperties(properties: unknown): BasesPropertyId[] {
	if (!Array.isArray(properties)) {
		return [];
	}

	return properties.filter((propertyId): propertyId is BasesPropertyId => {
		return typeof propertyId === "string";
	});
}

function getPropertyCandidates(
	selectedProperties: BasesPropertyId[],
	allProperties: BasesPropertyId[]
): BasesPropertyId[] {
	if (allProperties.length === 0) {
		return selectedProperties;
	}

	const propertyIds = new Set<BasesPropertyId>(selectedProperties);
	for (const propertyId of allProperties) {
		propertyIds.add(propertyId);
	}

	return [...propertyIds];
}

function detectGroupByProperty(
	groups: BasesEntryGroup[],
	selectedProperties: BasesPropertyId[]
): BasesPropertyId | null {
	const groupsWithValues = groups.filter(
		(group) =>
			group.key !== undefined &&
			!(group.key instanceof NullValue) &&
			group.entries.length > 0
	);

	if (groupsWithValues.length === 0) {
		return null;
	}

	for (const propertyId of selectedProperties) {
		if (propertyId === "file.name") {
			continue;
		}

		const matchesAllGroups = groupsWithValues.every((group) => {
			const groupKey = String(group.key);
			return group.entries.every((entry) => {
				const value = entry.getValue(propertyId);
				if (value === null || value === undefined || value instanceof NullValue) {
					return false;
				}

				return String(value) === groupKey;
			});
		});

		if (matchesAllGroups) {
			return propertyId;
		}
	}

	return null;
}

function formatPropertyValue(value: unknown): string | null {
	if (value === null || value === undefined || value instanceof NullValue) {
		return null;
	}

	const stringValue = String(value).trim();
	return stringValue.length > 0 ? stringValue : null;
}

function parseSingleWikiLink(
	value: string
): { target: string; display: string } | null {
	const match = value.match(/^\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|([^\]]+))?\]\]$/);
	if (match === null) {
		return null;
	}

	const target = match[1].trim();
	if (target.length === 0) {
		return null;
	}

	const alias = match[2]?.trim();
	const display = alias && alias.length > 0 ? alias : target;
	return { target, display };
}

function getColumnName(groupKey: unknown): string {
	if (groupKey === undefined || groupKey instanceof NullValue) {
		return NO_VALUE_COLUMN;
	}

	return String(groupKey);
}

function getColumnKey(groupKey: unknown): string {
	if (groupKey === undefined || groupKey instanceof NullValue) {
		return NO_VALUE_COLUMN_KEY;
	}

	return String(groupKey);
}

function sortRange(start: number, end: number): [number, number] {
	return start <= end ? [start, end] : [end, start];
}

function getWritablePropertyKey(propertyId: BasesPropertyId): string | null {
	if (propertyId.startsWith("file.") || propertyId.startsWith("formula.")) {
		return null;
	}

	const lastDotIndex = propertyId.lastIndexOf(".");
	if (lastDotIndex === -1 || lastDotIndex === propertyId.length - 1) {
		return propertyId;
	}

	return propertyId.slice(lastDotIndex + 1);
}

function reorderPaths(
	paths: string[],
	movedPath: string,
	targetPath: string | null,
	placement: "before" | "after"
): string[] {
	const nextPaths = paths.filter((path) => path !== movedPath);
	if (targetPath === null) {
		nextPaths.push(movedPath);
		return nextPaths;
	}

	const targetIndex = nextPaths.indexOf(targetPath);
	if (targetIndex === -1) {
		nextPaths.push(movedPath);
		return nextPaths;
	}

	const insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
	nextPaths.splice(insertionIndex, 0, movedPath);
	return nextPaths;
}

function toFiniteNumber(value: unknown): number | null {
	if (value === null || value === undefined || value instanceof NullValue) {
		return null;
	}

	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : null;
}

function getCardDropTargetFromColumn(
	cardsEl: HTMLElement,
	clientY: number
): { path: string; placement: "before" | "after" } | null {
	const cards = cardsEl.querySelectorAll<HTMLElement>(".bases-kanban-card");
	if (cards.length === 0) {
		return null;
	}

	let bestDistance = Number.POSITIVE_INFINITY;
	let bestPath: string | null = null;
	let bestPlacement: "before" | "after" = "after";

	cards.forEach((cardEl) => {
		const path = cardEl.dataset.cardPath;
		if (typeof path !== "string" || path.length === 0) {
			return;
		}

		const rect = cardEl.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const distance = Math.abs(clientY - midY);
		if (distance >= bestDistance) {
			return;
		}

		bestDistance = distance;
		bestPath = path;
		bestPlacement = clientY < midY ? "before" : "after";
	});

	if (bestPath === null) {
		return null;
	}

	return { path: bestPath, placement: bestPlacement };
}

function sortEntriesByRank(
	entries: BasesEntry[],
	sortConfig: { propertyId: BasesPropertyId; direction: "ASC" | "DESC" }
): BasesEntry[] {
	const rankedEntries = entries.map((entry, index) => {
		const rank = toFiniteNumber(entry.getValue(sortConfig.propertyId));
		return {
			entry,
			rank,
			index,
		};
	});

	rankedEntries.sort((a, b) => {
		if (a.rank === null && b.rank === null) {
			return a.index - b.index;
		}

		if (a.rank === null) {
			return 1;
		}

		if (b.rank === null) {
			return -1;
		}

		const difference =
			sortConfig.direction === "ASC" ? a.rank - b.rank : b.rank - a.rank;
		if (difference !== 0) {
			return difference;
		}

		return a.index - b.index;
	});

	return rankedEntries.map((entry) => entry.entry);
}

function getTargetGroupValue(groupKey: unknown): string | null {
	if (groupKey === undefined || groupKey instanceof NullValue) {
		return null;
	}

	return String(groupKey);
}

function isSameGroupValue(currentValue: unknown, targetValue: string | null): boolean {
	if (currentValue instanceof NullValue || currentValue === null || currentValue === undefined) {
		return targetValue === null;
	}

	return String(currentValue) === targetValue;
}

function resolveFrontmatterKey(
	frontmatter: Record<string, unknown>,
	propertyId: BasesPropertyId,
	propertyKey: string
): string {
	if (Object.prototype.hasOwnProperty.call(frontmatter, propertyId)) {
		return propertyId;
	}

	if (Object.prototype.hasOwnProperty.call(frontmatter, propertyKey)) {
		return propertyKey;
	}

	return propertyKey;
}
