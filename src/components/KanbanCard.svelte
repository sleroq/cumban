<script lang="ts">
    import { getContext, onDestroy } from "svelte";
    import { type BasesEntry, type BasesPropertyId } from "obsidian";
    import type { PropertyEditorMode } from "../kanban-view/actions";
    import type { PropertyType } from "../kanban-view/actions";
    import { PropertyValueEditorSuggest } from "../kanban-view/property-value-suggest-popover";
    import { getPropertyValues, parseWikiLinks } from "../kanban-view/utils";
    import {
        KANBAN_BOARD_CONTEXT_KEY,
        type KanbanBoardContext,
    } from "../kanban-view/board-context";
    import { KANBAN_CONTEXT_KEY } from "../kanban-view/context";
    import type { KanbanContext } from "../kanban-view/context";

    type Props = {
        entry: BasesEntry;
        columnKey: string;
        groupKey: unknown;
        cardIndex: number;
        onDragStart: (
            evt: DragEvent,
            filePath: string,
            cardIndex: number,
        ) => void;
        onDragEnd: () => void;
        onSetDropTarget: (
            targetPath: string | null,
            targetColumnKey: string | null,
            placement: "before" | "after" | null,
        ) => void;
        onDrop: (
            filePath: string | null,
            groupKey: unknown,
            placement: "before" | "after",
        ) => void;
    };

    let {
        entry,
        columnKey,
        groupKey,
        cardIndex,
        onDragStart,
        onDragEnd,
        onSetDropTarget,
        onDrop,
    }: Props = $props();

    const { app, settingsStore, selectedPathsStore } =
        getContext<KanbanContext>(KANBAN_CONTEXT_KEY);
    const boardContext = getContext<KanbanBoardContext>(
        KANBAN_BOARD_CONTEXT_KEY,
    );
    const settings = $derived($settingsStore);
    const groupByProperty = $derived(boardContext.groupByProperty);
    const selectedProperties = $derived(boardContext.selectedProperties);
    const callbacks = $derived(boardContext.callbacks);
    const dragState = boardContext.dragState;

    let cardEl: HTMLElement | null = $state(null);
    let isDraggable: boolean = $state(false);
    let rafId: number | null = null;
    let propertyEditorEl: HTMLElement | null = $state(null);
    let propertyInputEl: HTMLElement | null = $state(null);
    let editingPropertyId: BasesPropertyId | null = $state(null);
    let editingMode: PropertyEditorMode | null = $state(null);
    let editingValues: string[] = $state([]);
    let originalValues: string[] = [];
    let editInput = $state("");
    let hasChanges = $state(false);
    let isSaving = $state(false);
    let activeSuggest: PropertyValueEditorSuggest | null = null;
    let optimisticPropertyValues: Record<string, unknown> = $state({});
    let titleInputEl: HTMLInputElement | null = $state(null);
    let isEditingTitle = $state(false);
    let titleDraft = $state("");
    let isRenamingTitle = $state(false);

    let pendingContentSync = $state<{
        content: string;
        placeCaret: boolean;
    } | null>(null);

    function syncContenteditable(
        node: HTMLElement,
        _initialOptions: { content: string; placeCaret: boolean } | null,
    ): {
        update: (
            options: { content: string; placeCaret: boolean } | null,
        ) => void;
    } {
        return {
            update(newOptions): void {
                if (newOptions !== null) {
                    node.textContent = newOptions.content;
                    if (
                        newOptions.placeCaret &&
                        newOptions.content.length > 0
                    ) {
                        placeCaretAtEnd(node);
                    }
                }
            },
        };
    }

    const filePath = $derived(entry.file.path);
    const fullTitle = $derived(getCardTitle(entry, settings.cardTitleSource));
    const title = $derived(
        truncateTitle(fullTitle, settings.cardTitleMaxLength),
    );

    const propertiesToDisplay = $derived(
        selectedProperties.filter(
            (propertyId) =>
                propertyId !== "file.name" && propertyId !== groupByProperty,
        ),
    );

    const selected = $derived($selectedPathsStore.has(filePath));

    const isDropTarget = $derived(dragState.cardDropTargetStore(filePath));
    const dropPlacement = $derived(dragState.cardDropPlacementStore(filePath));
    const isDraggingSource = $derived(dragState.cardSourceStore(filePath));

    type PrettyPropertiesApi = {
        getPropertyBackgroundColorValue: (
            propName: string,
            propValue: string,
        ) => string;
        getPropertyTextColorValue: (
            propName: string,
            propValue: string,
        ) => string;
    };

    type WindowWithPrettyPropertiesApi = Window & {
        PrettyPropertiesApi?: PrettyPropertiesApi;
    };

    function getCardTitle(
        entry: BasesEntry,
        source: "basename" | "filename" | "path",
    ): string {
        switch (source) {
            case "filename":
                return entry.file.name;
            case "path":
                return entry.file.path;
            case "basename":
            default:
                return entry.file.basename;
        }
    }

    function truncateTitle(text: string, maxLength: number): string {
        if (maxLength <= 0 || text.length <= maxLength) {
            return text;
        }
        return text.slice(0, maxLength - 3) + "...";
    }

    function truncatePropertyValue(text: string, maxLength: number): string {
        if (maxLength <= 0 || text.length <= maxLength) {
            return text;
        }
        if (maxLength <= 3) {
            return ".".repeat(maxLength);
        }
        return text.slice(0, maxLength - 3) + "...";
    }

    function normalizeTagValue(value: string): string {
        if (value.startsWith("#")) {
            return value.slice(1);
        }
        return value;
    }

    function getTagDisplayValue(value: string, isTagProperty: boolean): string {
        if (!isTagProperty) {
            return value;
        }
        const normalizedTagValue = normalizeTagValue(value);
        if (normalizedTagValue.length === 0) {
            return value;
        }
        return `#${normalizedTagValue}`;
    }

    function getPrettyTagStyleVars(
        value: string,
        isTagProperty: boolean,
        options?: { fallbackToAccent?: boolean },
    ): string | undefined {
        const fallbackToAccent = options?.fallbackToAccent ?? false;
        if (!isTagProperty || typeof window === "undefined") {
            return undefined;
        }

        const prettyApi = (window as WindowWithPrettyPropertiesApi)
            .PrettyPropertiesApi;
        if (prettyApi === undefined && !fallbackToAccent) {
            return undefined;
        }

        const normalizedTagValue = normalizeTagValue(value);
        const background =
            prettyApi?.getPropertyBackgroundColorValue(
                "tags",
                normalizedTagValue,
            ) ?? "";
        const text =
            prettyApi?.getPropertyTextColorValue("tags", normalizedTagValue) ??
            "";

        const cssVars: string[] = [];
        if (background !== "") {
            cssVars.push(`--tag-background: ${background}`);
            cssVars.push(`--tag-background-hover: ${background}`);
        } else if (fallbackToAccent) {
            cssVars.push("--tag-background: var(--interactive-accent)");
            cssVars.push(
                "--tag-background-hover: var(--interactive-accent-hover, var(--interactive-accent))",
            );
        }
        if (text !== "") {
            cssVars.push(`--tag-color: ${text}`);
            cssVars.push(`--tag-color-hover: ${text}`);
        } else if (fallbackToAccent) {
            cssVars.push("--tag-color: var(--text-on-accent)");
            cssVars.push("--tag-color-hover: var(--text-on-accent)");
        }

        if (cssVars.length === 0) {
            return undefined;
        }

        return cssVars.join("; ");
    }

    function getPrettyTagPillStyle(
        value: string,
        isTagProperty: boolean,
        options?: { fallbackToAccent?: boolean },
    ): string | undefined {
        const cssVars = getPrettyTagStyleVars(value, isTagProperty, options);
        if (cssVars === undefined) {
            return undefined;
        }

        const styles: string[] = [];
        for (const segment of cssVars.split(";")) {
            const [rawKey, rawValue] = segment.split(":");
            if (rawKey === undefined || rawValue === undefined) {
                continue;
            }
            const key = rawKey.trim();
            const valuePart = rawValue.trim();
            if (key === "--tag-background") {
                styles.push(`background: ${valuePart}`);
            }
            if (key === "--tag-color") {
                styles.push(`color: ${valuePart}`);
            }
        }

        if (styles.length === 0) {
            return undefined;
        }

        return styles.join("; ");
    }

    function arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }

    function markChanges(): void {
        hasChanges = !arraysEqual(editingValues, originalValues);
    }

    function normalizeInputValue(rawValue: string): string {
        return rawValue.trim();
    }

    function clearEditInput(): void {
        editInput = "";
        pendingContentSync = { content: "", placeCaret: false };
    }

    function getCurrentEditInput(): string {
        if (propertyInputEl !== null) {
            return propertyInputEl.textContent ?? "";
        }
        return editInput;
    }

    function isEditInputCompletelyEmpty(): boolean {
        return getCurrentEditInput().length === 0;
    }

    function placeCaretAtEnd(el: HTMLElement): void {
        const selection = window.getSelection();
        if (selection === null) {
            return;
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function addValue(value: string): void {
        const normalizedValue = normalizeInputValue(value);
        if (normalizedValue.length === 0 || editingMode === null) {
            return;
        }

        if (editingMode === "single") {
            editingValues = [normalizedValue];
            editInput = normalizedValue;
            pendingContentSync = { content: normalizedValue, placeCaret: true };
            markChanges();
            return;
        }

        if (editingValues.includes(normalizedValue)) {
            clearEditInput();
            return;
        }

        editingValues = [...editingValues, normalizedValue];
        clearEditInput();
        markChanges();
    }

    function commitPendingInput(): void {
        if (editingMode === "single") {
            const pendingValue = normalizeInputValue(getCurrentEditInput());
            editingValues = pendingValue.length === 0 ? [] : [pendingValue];
            markChanges();
            return;
        }

        const pendingValue = normalizeInputValue(getCurrentEditInput());
        if (pendingValue.length === 0) {
            return;
        }
        addValue(pendingValue);
    }

    function removeValue(index: number): void {
        if (index < 0 || index >= editingValues.length) {
            return;
        }

        editingValues = editingValues.filter((_, valueIndex) => {
            return valueIndex !== index;
        });
        markChanges();
    }

    function beginPropertyEditing(
        propertyId: BasesPropertyId,
        mode: PropertyEditorMode,
        values: string[],
    ): void {
        editingPropertyId = propertyId;
        editingMode = mode;
        editingValues = [...values];
        originalValues = [...values];
        editInput = mode === "single" ? (values[0] ?? "") : "";
        hasChanges = false;
        boardContext.setActivePropertyEditor(
            filePath,
            () => exitPropertyEditing(true),
            isTargetInsidePropertyEditor,
        );
        queueMicrotask(() => {
            if (mode === "single") {
                pendingContentSync = { content: editInput, placeCaret: true };
            }
            propertyInputEl?.focus();
            refreshSuggestions();
        });
    }

    function ensureSuggest(): void {
        if (activeSuggest !== null || propertyInputEl === null) {
            return;
        }

        activeSuggest = new PropertyValueEditorSuggest({
            app,
            inputEl: propertyInputEl,
            sourcePath: filePath,
            getItems: (query: string) => {
                if (editingPropertyId === null) {
                    return [];
                }
                return getFilteredSuggestions(editingPropertyId, query);
            },
            onChoose: (value: string) => {
                addValue(value);
                if (editingMode === "single") {
                    void exitPropertyEditing(true);
                    return;
                }
                queueMicrotask(() => {
                    propertyInputEl?.focus();
                });
            },
        });
    }

    function clearEditingState(): void {
        activeSuggest?.close();
        activeSuggest = null;
        boardContext.clearActivePropertyEditor(filePath);
        editingPropertyId = null;
        editingMode = null;
        editingValues = [];
        originalValues = [];
        editInput = "";
        hasChanges = false;
        isSaving = false;
    }

    function getDisplayPropertyRawValue(propertyId: BasesPropertyId): unknown {
        if (
            Object.prototype.hasOwnProperty.call(
                optimisticPropertyValues,
                propertyId,
            )
        ) {
            return optimisticPropertyValues[propertyId];
        }

        return entry.getValue(propertyId);
    }

    function setOptimisticPropertyValues(
        propertyId: BasesPropertyId,
        mode: PropertyEditorMode,
        values: string[],
    ): void {
        const nextValue: unknown =
            mode === "single"
                ? (values[0] ?? null)
                : values.length === 0
                  ? null
                  : [...values];

        optimisticPropertyValues = {
            ...optimisticPropertyValues,
            [propertyId]: nextValue,
        };
    }

    async function exitPropertyEditing(save: boolean): Promise<void> {
        if (editingPropertyId === null || editingMode === null) {
            return;
        }

        const propertyId = editingPropertyId;
        const mode = editingMode;

        commitPendingInput();

        if (save && hasChanges && !isSaving) {
            isSaving = true;
            try {
                await callbacks.card.updatePropertyValues(
                    filePath,
                    propertyId,
                    mode,
                    editingValues,
                );
                setOptimisticPropertyValues(propertyId, mode, editingValues);
            } finally {
                clearEditingState();
            }
            return;
        }

        clearEditingState();
    }

    function isTargetInsidePropertyEditor(target: Node): boolean {
        const editorEl = propertyEditorEl;
        if (editorEl !== null && editorEl.contains(target)) {
            return true;
        }

        if (
            target instanceof HTMLElement &&
            target.closest(".suggestion-container") !== null
        ) {
            return true;
        }

        return false;
    }

    async function switchPropertyEditing(
        propertyId: BasesPropertyId,
        mode: PropertyEditorMode,
        values: string[],
    ): Promise<void> {
        if (editingPropertyId !== null && editingPropertyId !== propertyId) {
            await exitPropertyEditing(true);
        }

        beginPropertyEditing(propertyId, mode, values);
    }

    function handlePropertyRowClick(
        evt: MouseEvent,
        propertyId: BasesPropertyId,
        mode: PropertyEditorMode | null,
        values: string[] | null,
    ): void {
        const target = evt.target;
        if (
            target instanceof HTMLElement &&
            target.closest(".external-link") !== null
        ) {
            return;
        }
        if (mode === null) {
            return;
        }
        if (values === null) {
            return;
        }
        evt.preventDefault();
        evt.stopPropagation();
        void switchPropertyEditing(propertyId, mode, values);
    }

    function handlePropertyEditorClick(evt: MouseEvent): void {
        evt.stopPropagation();
    }

    function handlePropertyInputKeyDown(evt: KeyboardEvent): void {
        evt.stopPropagation();

        if (evt.key === "Enter" || evt.key === ",") {
            evt.preventDefault();
            addValue(getCurrentEditInput());
            return;
        }

        if (evt.key === "Backspace" && isEditInputCompletelyEmpty()) {
            removeValue(editingValues.length - 1);
            return;
        }

        if (evt.key === "Escape") {
            evt.preventDefault();
            void exitPropertyEditing(true);
            return;
        }

        if (evt.key === "Tab" && evt.shiftKey === false) {
            const completedValue = activeSuggest?.completeSelectedSuggestion();
            if (completedValue !== undefined && completedValue !== null) {
                evt.preventDefault();
                if (editingMode === "single") {
                    addValue(completedValue);
                    void exitPropertyEditing(true);
                    return;
                }
                editInput = completedValue;
                queueMicrotask(() => {
                    if (propertyInputEl === null) {
                        return;
                    }
                    propertyInputEl.focus();
                    placeCaretAtEnd(propertyInputEl);
                });
                return;
            }
            commitPendingInput();
            return;
        }

        if (evt.key === "ArrowDown" || (evt.ctrlKey && evt.key === " ")) {
            evt.preventDefault();
            refreshSuggestions();
        }
    }

    function handleRemoveValue(
        evt: MouseEvent | KeyboardEvent,
        index: number,
    ): void {
        evt.preventDefault();
        evt.stopPropagation();
        removeValue(index);
    }

    function getFilteredSuggestions(
        propertyId: BasesPropertyId,
        query: string,
    ): string[] {
        const allSuggestions =
            callbacks.card.getPropertySuggestions(propertyId);
        const normalizedQuery = query.trim().toLowerCase();
        return allSuggestions.filter((value: string) => {
            const isAlreadySelected = editingValues.includes(value);
            if (isAlreadySelected) {
                return false;
            }
            if (normalizedQuery.length === 0) {
                return true;
            }
            return value.toLowerCase().includes(normalizedQuery);
        });
    }

    function refreshSuggestions(): void {
        if (editingPropertyId === null || propertyInputEl === null) {
            return;
        }
        ensureSuggest();
        propertyInputEl.dispatchEvent(new Event("input"));
    }

    function closeSuggestWhenEmpty(): void {
        if (editingPropertyId === null) {
            return;
        }
        const suggestions = getFilteredSuggestions(
            editingPropertyId,
            editInput,
        );
        if (suggestions.length === 0) {
            activeSuggest?.close();
        }
    }

    onDestroy(() => {
        boardContext.clearActivePropertyEditor(filePath);
        activeSuggest?.close();
        activeSuggest = null;
    });

    function handleClick(evt: MouseEvent): void {
        if ((evt.target as HTMLElement).closest("a") !== null) {
            return;
        }
        callbacks.card.select(filePath, evt.shiftKey || evt.metaKey);
    }

    function handleMouseDown(evt: MouseEvent): void {
        if (groupByProperty === null) {
            return;
        }

        if (evt.button !== 0) {
            isDraggable = false;
            return;
        }

        const target = evt.target;
        if (
            target instanceof Node &&
            (isTargetInsidePropertyEditor(target) ||
                isTargetInsideTitleEditor(target))
        ) {
            isDraggable = false;
            return;
        }

        isDraggable = true;
    }

    function handleMouseUp(): void {
        if (!$isDraggingSource) {
            isDraggable = false;
        }
    }

    function handleDragStart(evt: DragEvent): void {
        onDragStart(evt, filePath, cardIndex);
    }

    function handleDragEnd(): void {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        onDragEnd();
    }

    function handleDragOver(evt: DragEvent): void {
        if (groupByProperty === null) return;
        evt.preventDefault();
        evt.stopPropagation();

        if (rafId !== null) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (cardEl !== null) {
                const rect = cardEl.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const placement = evt.clientY < midY ? "before" : "after";
                onSetDropTarget(filePath, columnKey, placement);
            }
        });
    }

    function handleDragLeave(evt: DragEvent): void {
        const relatedTarget = evt.relatedTarget as Node | null;
        if (relatedTarget === null) {
            return;
        }
        if (cardEl !== null && cardEl.contains(relatedTarget)) {
            return;
        }
        onSetDropTarget(null, null, null);
    }

    function handleDrop(evt: DragEvent): void {
        if (groupByProperty === null) return;
        evt.preventDefault();
        evt.stopPropagation();
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        let placement = dragState.getCardDropPlacement(filePath) ?? "after";
        if (cardEl !== null) {
            const rect = cardEl.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            placement = evt.clientY < midY ? "before" : "after";
        }
        onDrop(filePath, groupKey, placement);
    }

    function handleContextMenu(evt: MouseEvent): void {
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        callbacks.card.contextMenu(evt, entry);
    }

    function handleLinkClick(evt: MouseEvent): void {
        evt.preventDefault();
        evt.stopPropagation();
        callbacks.card.linkClick(evt, filePath);
    }

    function handleTitleContextMenu(evt: MouseEvent): void {
        callbacks.card.contextMenu(evt, entry);
    }

    function stopTitleEditorEvent(evt: MouseEvent): void {
        evt.stopPropagation();
    }

    function beginTitleEditing(evt: MouseEvent): void {
        evt.preventDefault();
        evt.stopPropagation();
        if (isEditingTitle || isRenamingTitle) {
            return;
        }

        titleDraft = entry.file.basename;
        isEditingTitle = true;
        queueMicrotask(() => {
            titleInputEl?.focus();
            titleInputEl?.select();
        });
    }

    function cancelTitleEditing(): void {
        isEditingTitle = false;
        titleDraft = "";
        isRenamingTitle = false;
    }

    async function saveTitleEditing(): Promise<void> {
        if (!isEditingTitle || isRenamingTitle) {
            return;
        }

        const nextTitle = titleDraft.trim();
        if (nextTitle.length === 0 || nextTitle === entry.file.basename) {
            cancelTitleEditing();
            return;
        }

        isRenamingTitle = true;
        try {
            await callbacks.card.rename(filePath, nextTitle);
        } finally {
            cancelTitleEditing();
        }
    }

    function handleTitleInputKeyDown(evt: KeyboardEvent): void {
        evt.stopPropagation();
        if (evt.key === "Enter") {
            evt.preventDefault();
            void saveTitleEditing();
            return;
        }

        if (evt.key === "Escape") {
            evt.preventDefault();
            cancelTitleEditing();
        }
    }

    function isTargetInsideTitleEditor(target: Node): boolean {
        const inputEl = titleInputEl;
        if (inputEl === null) {
            return false;
        }
        return inputEl.contains(target);
    }

    function handlePropertyLinkClick(evt: MouseEvent, target: string): void {
        evt.preventDefault();
        evt.stopPropagation();
        callbacks.card.linkClick(evt, target);
    }

    type EditableLinkInfo = {
        target: string;
        display: string;
    };

    function getEditableLinkInfo(value: string): EditableLinkInfo | null {
        const trimmedValue = value.trim();
        if (trimmedValue.length === 0) {
            return null;
        }

        const wikiLinks = parseWikiLinks(trimmedValue);
        if (
            wikiLinks.length === 1 &&
            trimmedValue.startsWith("[[") &&
            trimmedValue.endsWith("]]")
        ) {
            return wikiLinks[0];
        }

        const linkedFile = app.metadataCache.getFirstLinkpathDest(
            trimmedValue,
            filePath,
        );
        if (linkedFile !== null) {
            return {
                target: trimmedValue,
                display: trimmedValue,
            };
        }

        return null;
    }

    function getExternalLinkHref(value: string): string | null {
        const trimmedValue = value.trim();
        if (trimmedValue.length === 0 || trimmedValue.includes(" ")) {
            return null;
        }

        try {
            const url = new URL(trimmedValue);
            if (url.protocol === "http:" || url.protocol === "https:") {
                return trimmedValue;
            }
        } catch {
            return null;
        }

        return null;
    }

    function isDateType(type: PropertyType): boolean {
        return type === "date" || type === "datetime" || type === "time";
    }

    function getPropertyDisplayName(propertyId: BasesPropertyId): string {
        if (propertyId.startsWith("note.")) {
            return propertyId.slice("note.".length);
        }

        const lastDotIndex = propertyId.lastIndexOf(".");
        if (lastDotIndex !== -1 && lastDotIndex < propertyId.length - 1) {
            return propertyId.slice(lastDotIndex + 1);
        }

        return propertyId;
    }

    function handleCheckboxClick(evt: MouseEvent): void {
        evt.stopPropagation();
    }

    async function handleCheckboxChange(
        evt: Event,
        propertyId: BasesPropertyId,
    ): Promise<void> {
        evt.stopPropagation();
        const target = evt.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        await callbacks.card.updatePropertyCheckbox(
            filePath,
            propertyId,
            target.checked,
        );
    }

    function getRelativeDate(dateValue: string): "past" | "future" | "today" {
        const parsedDate = Date.parse(dateValue);
        if (isNaN(parsedDate)) {
            return "future";
        }

        const now = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;
        const todayStart = Math.floor(now / msPerDay) * msPerDay;
        const dateStart = Math.floor(parsedDate / msPerDay) * msPerDay;

        if (dateStart === todayStart) {
            return "today";
        }
        return dateStart < todayStart ? "past" : "future";
    }

    function formatDateValue(value: string, type: PropertyType): string {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            return value;
        }

        if (type === "date") {
            return date.toLocaleDateString();
        }
        if (type === "datetime") {
            return date.toLocaleString();
        }
        if (type === "time") {
            return date.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
            });
        }
        return value;
    }

    function getDailyNotePath(dateValue: string): string {
        const date = new Date(dateValue);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}.md`;
    }

    function handleDateIconClick(
        evt: MouseEvent | KeyboardEvent,
        dateValue: string,
    ): void {
        evt.preventDefault();
        evt.stopPropagation();
        const dailyNotePath = getDailyNotePath(dateValue);
        const syntheticEvt =
            evt instanceof MouseEvent
                ? evt
                : new MouseEvent("click", { bubbles: true });
        callbacks.card.linkClick(syntheticEvt, dailyNotePath);
    }

    function handleKeyDown(evt: KeyboardEvent): void {
        if (evt.key !== "Enter" && evt.key !== " ") {
            return;
        }
        evt.preventDefault();
        callbacks.card.select(filePath, evt.shiftKey || evt.metaKey);
    }
</script>

<div
    bind:this={cardEl}
    class="bases-kanban-card"
    class:bases-kanban-card-selected={selected}
    class:bases-kanban-card-dragging={$isDraggingSource}
    class:bases-kanban-card-drop-before={$isDropTarget &&
        $dropPlacement === "before"}
    class:bases-kanban-card-drop-after={$isDropTarget &&
        $dropPlacement === "after"}
    draggable={isDraggable}
    data-card-path={filePath}
    onclick={handleClick}
    onmousedown={handleMouseDown}
    onmouseup={handleMouseUp}
    onkeydown={handleKeyDown}
    ondragstart={handleDragStart}
    ondragend={handleDragEnd}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    oncontextmenu={handleContextMenu}
    role="button"
    tabindex="0"
>
    <div class="bases-kanban-card-title">
        {#if isEditingTitle}
            <input
                bind:this={titleInputEl}
                class="bases-kanban-card-title-input"
                type="text"
                bind:value={titleDraft}
                onmousedown={stopTitleEditorEvent}
                onclick={stopTitleEditorEvent}
                onkeydown={handleTitleInputKeyDown}
                onblur={() => {
                    void saveTitleEditing();
                }}
            />
        {:else}
            <!-- svelte-ignore a11y_invalid_attribute -->
            <a
                href="#"
                class="internal-link"
                style:color={settings.cardTitleColor}
                onclick={handleLinkClick}
                oncontextmenu={handleTitleContextMenu}
            >
                {title}
            </a>
            <button
                class="bases-kanban-card-title-edit-button"
                type="button"
                aria-label="Rename card title"
                onclick={beginTitleEditing}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="svg-icon lucide-pencil"
                    ><path
                        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                    ></path><path d="m15 5 4 4"></path></svg
                >
            </button>
        {/if}
    </div>

    {#if propertiesToDisplay.length > 0}
        <div class="bases-kanban-card-properties">
            {#each propertiesToDisplay as propertyId (propertyId)}
                {@const rawValue = getDisplayPropertyRawValue(propertyId)}
                {@const values = getPropertyValues(rawValue)}
                {@const mode = callbacks.card.getPropertyEditorMode(propertyId)}
                {@const propertyType =
                    callbacks.card.getPropertyType(propertyId)}
                {#if values !== null || propertyType === "checkbox"}
                    {@const isTagProperty = propertyId.endsWith(
                        settings.tagPropertySuffix,
                    )}
                    {@const isEditingProperty =
                        editingPropertyId === propertyId}
                    {@const isCheckboxProperty = propertyType === "checkbox"}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="bases-kanban-property-row"
                        class:bases-kanban-property-row-editable={mode !==
                            null && !isCheckboxProperty}
                        class:bases-kanban-property-row-editing={isEditingProperty}
                        onclick={(evt: MouseEvent) =>
                            handlePropertyRowClick(
                                evt,
                                propertyId,
                                mode,
                                values,
                            )}
                    >
                        {#if isCheckboxProperty}
                            {@const checked =
                                callbacks.card.getPropertyCheckboxState(
                                    filePath,
                                    propertyId,
                                )}
                            <div class="bases-kanban-checkbox-row">
                                <span class="bases-kanban-property-name">
                                    {getPropertyDisplayName(propertyId)}
                                </span>
                                <div
                                    class="bases-kanban-property-value metadata-property-value"
                                    data-property-type="checkbox"
                                >
                                    <input
                                        class="metadata-input-checkbox"
                                        type="checkbox"
                                        data-indeterminate="false"
                                        {checked}
                                        onclick={handleCheckboxClick}
                                        onchange={(evt: Event) =>
                                            void handleCheckboxChange(
                                                evt,
                                                propertyId,
                                            )}
                                    />
                                </div>
                            </div>
                        {:else if isEditingProperty && mode !== null}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                bind:this={propertyEditorEl}
                                class="multi-select-container"
                                tabindex="-1"
                                onclick={handlePropertyEditorClick}
                            >
                                {#if mode === "multi"}
                                    {#each editingValues as value, valueIndex (`${value}-${valueIndex}`)}
                                        {@const pillClass = isTagProperty
                                            ? "multi-select-pill theme-color"
                                            : "multi-select-pill"}
                                        {@const editableLinkInfo = isTagProperty
                                            ? null
                                            : getEditableLinkInfo(value)}
                                        {@const displayValue =
                                            getTagDisplayValue(
                                                value,
                                                isTagProperty,
                                            )}
                                        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                        <div
                                            class={pillClass}
                                            tabindex="0"
                                            data-tag-value={value}
                                            style={getPrettyTagPillStyle(
                                                value,
                                                isTagProperty,
                                                { fallbackToAccent: true },
                                            )}
                                        >
                                            <div
                                                class="multi-select-pill-content"
                                                class:internal-link={editableLinkInfo !==
                                                    null}
                                                data-href={editableLinkInfo?.target}
                                                draggable={editableLinkInfo !==
                                                    null}
                                            >
                                                <span
                                                    >{editableLinkInfo?.display ??
                                                        displayValue}</span
                                                >
                                                {#if editableLinkInfo !== null}
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        width="24"
                                                        height="24"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        class="svg-icon lucide-link"
                                                        aria-hidden="true"
                                                        ><path
                                                            d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                                                        ></path><path
                                                            d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                                                        ></path></svg
                                                    >
                                                {/if}
                                            </div>
                                            <div
                                                class="multi-select-pill-remove-button"
                                                role="button"
                                                tabindex="0"
                                                onclick={(evt: MouseEvent) =>
                                                    handleRemoveValue(
                                                        evt,
                                                        valueIndex,
                                                    )}
                                                onkeydown={(
                                                    evt: KeyboardEvent,
                                                ) => {
                                                    if (
                                                        evt.key === "Enter" ||
                                                        evt.key === " "
                                                    ) {
                                                        evt.preventDefault();
                                                        handleRemoveValue(
                                                            evt,
                                                            valueIndex,
                                                        );
                                                    }
                                                }}
                                            >
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    width="24"
                                                    height="24"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    class="svg-icon lucide-x"
                                                    ><path d="M18 6 6 18"
                                                    ></path><path d="m6 6 12 12"
                                                    ></path></svg
                                                >
                                            </div>
                                        </div>
                                    {/each}
                                {/if}
                                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                <div
                                    bind:this={propertyInputEl}
                                    use:syncContenteditable={pendingContentSync}
                                    class="multi-select-input"
                                    contenteditable="true"
                                    tabindex="0"
                                    autocapitalize="none"
                                    data-placeholder="Add value"
                                    oninput={(evt: Event) => {
                                        const target = evt.target;
                                        if (target instanceof HTMLElement) {
                                            editInput =
                                                target.textContent ?? "";
                                            closeSuggestWhenEmpty();
                                        }
                                    }}
                                    onkeydown={handlePropertyInputKeyDown}
                                    onfocus={() => {
                                        refreshSuggestions();
                                    }}
                                    onclick={handlePropertyEditorClick}
                                ></div>
                            </div>
                        {:else if values !== null}
                            {#each values as value, i (i)}
                                {@const displayValue = getTagDisplayValue(
                                    value,
                                    isTagProperty,
                                )}
                                {@const truncatedValue = truncatePropertyValue(
                                    displayValue,
                                    settings.propertyValueMaxLength,
                                )}
                                {@const links = parseWikiLinks(value)}
                                {@const isDateProp = isDateType(propertyType)}
                                {#if isDateProp}
                                    {@const relativeDate =
                                        getRelativeDate(value)}
                                    {@const formattedDate = formatDateValue(
                                        value,
                                        propertyType,
                                    )}
                                    <div
                                        class="bases-kanban-property-value metadata-property-value"
                                        data-property-type="date"
                                        data-relative-date={relativeDate}
                                    >
                                        <span class="metadata-date-value"
                                            >{formattedDate}</span
                                        >
                                        <div
                                            class="clickable-icon"
                                            role="button"
                                            tabindex="0"
                                            aria-label="Open daily note"
                                            onclick={(evt: MouseEvent) =>
                                                handleDateIconClick(evt, value)}
                                            onkeydown={(evt: KeyboardEvent) => {
                                                if (
                                                    evt.key === "Enter" ||
                                                    evt.key === " "
                                                ) {
                                                    evt.preventDefault();
                                                    handleDateIconClick(
                                                        evt,
                                                        value,
                                                    );
                                                }
                                            }}
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="24"
                                                height="24"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                class="svg-icon lucide-link"
                                                ><path
                                                    d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                                                ></path><path
                                                    d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                                                ></path></svg
                                            >
                                        </div>
                                    </div>
                                {:else if links.length === 0}
                                    {@const externalLinkHref = isTagProperty
                                        ? null
                                        : getExternalLinkHref(value)}
                                    {#if externalLinkHref !== null}
                                        <div
                                            class="bases-kanban-property-value metadata-property-value"
                                            data-property-type="text"
                                        >
                                            <div class="metadata-link">
                                                <div
                                                    class="metadata-link-inner external-link"
                                                    data-href={externalLinkHref}
                                                >
                                                    {truncatedValue}
                                                </div>
                                                <div
                                                    class="metadata-link-flair"
                                                >
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        width="24"
                                                        height="24"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        class="svg-icon lucide-pencil"
                                                        ><path
                                                            d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                                                        ></path><path
                                                            d="m15 5 4 4"
                                                        ></path></svg
                                                    >
                                                </div>
                                            </div>
                                        </div>
                                    {:else}
                                        {@const cls = isTagProperty
                                            ? "bases-kanban-property-value bases-kanban-property-tag"
                                            : "bases-kanban-property-value"}
                                        <span
                                            class={cls}
                                            style={getPrettyTagStyleVars(
                                                value,
                                                isTagProperty,
                                            )}
                                        >
                                            {truncatedValue}
                                        </span>
                                    {/if}
                                {:else}
                                    {#each links as link, linkIndex (linkIndex)}
                                        {@const truncatedLinkDisplay =
                                            truncatePropertyValue(
                                                link.display,
                                                settings.propertyValueMaxLength,
                                            )}
                                        {@const cls = isTagProperty
                                            ? "bases-kanban-property-value internal-link bases-kanban-property-link bases-kanban-property-tag"
                                            : "bases-kanban-property-value internal-link bases-kanban-property-link"}
                                        <!-- svelte-ignore a11y_invalid_attribute -->
                                        <a
                                            href="#"
                                            class={cls}
                                            style={getPrettyTagStyleVars(
                                                link.display,
                                                isTagProperty,
                                            )}
                                            onclick={(evt: MouseEvent) =>
                                                handlePropertyLinkClick(
                                                    evt,
                                                    link.target,
                                                )}
                                        >
                                            {truncatedLinkDisplay}
                                        </a>
                                        {#if !isTagProperty && linkIndex < links.length - 1}
                                            <span
                                                class="bases-kanban-property-separator"
                                                >{settings.propertyValueSeparator}</span
                                            >
                                        {/if}
                                    {/each}
                                {/if}
                                {#if !isTagProperty && i < values.length - 1}
                                    <span
                                        class="bases-kanban-property-separator"
                                        >{settings.propertyValueSeparator}</span
                                    >
                                {/if}
                            {/each}
                        {/if}
                        {#if mode !== null && !isCheckboxProperty && !isEditingProperty}
                            <span
                                class="bases-kanban-property-edit-indicator"
                                aria-hidden="true"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="svg-icon lucide-pencil"
                                    ><path
                                        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                                    ></path><path d="m15 5 4 4"></path></svg
                                >
                            </span>
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>
