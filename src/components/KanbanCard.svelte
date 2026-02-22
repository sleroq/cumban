<script lang="ts">
    import { onDestroy, onMount, getContext } from "svelte";
    import { setIcon, type BasesEntry, type BasesPropertyId } from "obsidian";
    import type { PropertyEditorMode } from "../kanban-view/actions";
    import { PropertyValueEditorSuggest } from "../kanban-view/property-value-suggest-popover";
    import {
        getPropertyValues,
        parseWikiLinks,
    } from "../kanban-view/utils";
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

    // Get settings and selection store from context
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

    // Derive selection status from store - each card subscribes individually
    // This is more efficient than parent passing selected as prop because
    // it prevents entire column re-render when selection changes
    const selected = $derived($selectedPathsStore.has(filePath));

    // Reactive stores for drag state (using store-returning methods for proper Svelte 5 reactivity)
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

    function normalizeTagValue(value: string): string {
        if (value.startsWith("#")) {
            return value.slice(1);
        }
        return value;
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
            prettyApi?.getPropertyTextColorValue(
                "tags",
                normalizedTagValue,
            ) ?? "";

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
            cssVars.push(
                "--tag-color-hover: var(--text-on-accent)",
            );
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

    function setXIcon(node: HTMLElement): { destroy: () => void } {
        node.empty();
        setIcon(node, "x");
        return {
            destroy(): void {
                node.empty();
            },
        };
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
        if (propertyInputEl !== null) {
            propertyInputEl.textContent = "";
        }
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
            clearEditInput();
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
        editInput = "";
        hasChanges = false;
        queueMicrotask(() => {
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
            getItems: (query: string) => {
                if (editingPropertyId === null) {
                    return [];
                }
                return getFilteredSuggestions(editingPropertyId, query);
            },
            onChoose: (value: string) => {
                addValue(value);
                queueMicrotask(() => {
                    propertyInputEl?.focus();
                });
            },
        });
    }

    function clearEditingState(): void {
        activeSuggest?.close();
        activeSuggest = null;
        editingPropertyId = null;
        editingMode = null;
        editingValues = [];
        originalValues = [];
        editInput = "";
        hasChanges = false;
        isSaving = false;
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
            } finally {
                clearEditingState();
            }
            return;
        }

        clearEditingState();
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
        values: string[],
    ): void {
        if (mode === null) {
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

        if (
            evt.key === "Backspace" &&
            isEditInputCompletelyEmpty()
        ) {
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

    function handleRemoveValue(evt: MouseEvent | KeyboardEvent, index: number): void {
        evt.preventDefault();
        evt.stopPropagation();
        removeValue(index);
    }

    function getFilteredSuggestions(
        propertyId: BasesPropertyId,
        query: string,
    ): string[] {
        const allSuggestions = callbacks.card.getPropertySuggestions(propertyId);
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
        const suggestions = getFilteredSuggestions(editingPropertyId, editInput);
        if (suggestions.length === 0) {
            activeSuggest?.close();
        }
    }

    onMount(() => {
        const handleDocumentMouseDown = (evt: MouseEvent): void => {
            if (editingPropertyId === null) {
                return;
            }

            const target = evt.target;
            if (!(target instanceof Node)) {
                return;
            }

            const editorEl = propertyEditorEl;
            if (editorEl !== null && editorEl.contains(target)) {
                return;
            }

            if (
                target instanceof HTMLElement &&
                target.closest(".suggestion-container") !== null
            ) {
                return;
            }

            void exitPropertyEditing(true);
        };

        document.addEventListener("mousedown", handleDocumentMouseDown, true);
        return () => {
            document.removeEventListener(
                "mousedown",
                handleDocumentMouseDown,
                true,
            );
        };
    });

    onDestroy(() => {
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
        if (groupByProperty !== null) {
            isDraggable = evt.button === 0;
        }
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
        // Cancel any pending RAF callback
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

        // Throttle drop target calculation via requestAnimationFrame
        // to reduce churn during drag operations
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
            rafId = null;
            // Calculate drop placement based on mouse position
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
        // Don't clear drop target if relatedTarget is null - HTML5 DnD fires dragleave
        // with null relatedTarget frequently. Only clear when moving to a different element.
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
        // Cancel any pending RAF callback to prevent stale state updates
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

    function handlePropertyLinkClick(evt: MouseEvent, target: string): void {
        evt.preventDefault();
        evt.stopPropagation();
        callbacks.card.linkClick(evt, target);
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
    </div>

    {#if propertiesToDisplay.length > 0}
        <div class="bases-kanban-card-properties">
            {#each propertiesToDisplay as propertyId (propertyId)}
                {@const values = getPropertyValues(entry.getValue(propertyId))}
                {#if values !== null}
                    {@const mode = callbacks.card.getPropertyEditorMode(
                        propertyId,
                    )}
                    {@const isTagProperty = propertyId.endsWith(
                        settings.tagPropertySuffix,
                    )}
                    {@const isEditingProperty = editingPropertyId === propertyId}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="bases-kanban-property-row"
                        class:bases-kanban-property-row-editable={mode !== null}
                        onclick={(evt: MouseEvent) =>
                            handlePropertyRowClick(evt, propertyId, mode, values)}
                    >
                        {#if isEditingProperty && mode !== null}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                bind:this={propertyEditorEl}
                                class="multi-select-container"
                                tabindex="-1"
                                onclick={handlePropertyEditorClick}
                            >
                                {#each editingValues as value, valueIndex (`${value}-${valueIndex}`)}
                                    {@const pillClass = isTagProperty
                                        ? "multi-select-pill theme-color"
                                        : "multi-select-pill"}
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
                                        <div class="multi-select-pill-content">
                                            <span>{value}</span>
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
                                            onkeydown={(evt: KeyboardEvent) => {
                                                if (evt.key === "Enter" || evt.key === " ") {
                                                    evt.preventDefault();
                                                    handleRemoveValue(evt, valueIndex);
                                                }
                                            }}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
                                        </div>
                                    </div>
                                {/each}
                                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                <div
                                    bind:this={propertyInputEl}
                                    class="multi-select-input"
                                    contenteditable="true"
                                    tabindex="0"
                                    autocapitalize="none"
                                    data-placeholder="Add value"
                                    oninput={(evt: Event) => {
                                        const target = evt.target;
                                        if (
                                            target instanceof HTMLElement
                                        ) {
                                            editInput = target.textContent ?? "";
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
                        {:else}
                            {#each values as value, i (i)}
                                {@const links = parseWikiLinks(value)}
                                {#if links.length === 0}
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
                                        {value}
                                    </span>
                                {:else}
                                    {#each links as link, linkIndex (linkIndex)}
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
                                            {link.display}
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
                                    <span class="bases-kanban-property-separator"
                                        >{settings.propertyValueSeparator}</span
                                    >
                                {/if}
                            {/each}
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>
