<script lang="ts">
    import { onDestroy, onMount, getContext } from "svelte";
    import { setIcon, type BasesEntry, type BasesPropertyId } from "obsidian";
    import type { PropertyEditorMode } from "../kanban-view/actions";
    import { PropertyValueSuggestModal } from "../kanban-view/property-value-suggest-modal";
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
    let propertyInputEl: HTMLInputElement | null = $state(null);
    let editingPropertyId: BasesPropertyId | null = $state(null);
    let editingMode: PropertyEditorMode | null = $state(null);
    let editingValues: string[] = $state([]);
    let originalValues: string[] = [];
    let editInput = $state("");
    let hasChanges = $state(false);
    let isSaving = $state(false);
    let activeModal: PropertyValueSuggestModal | null = null;
    let suggestTimeout: ReturnType<typeof setTimeout> | null = null;

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
    ): string | undefined {
        if (!isTagProperty || typeof window === "undefined") {
            return undefined;
        }

        const prettyApi = (window as WindowWithPrettyPropertiesApi)
            .PrettyPropertiesApi;
        if (prettyApi === undefined) {
            return undefined;
        }

        const normalizedTagValue = normalizeTagValue(value);
        const background = prettyApi.getPropertyBackgroundColorValue(
            "tags",
            normalizedTagValue,
        );
        const text = prettyApi.getPropertyTextColorValue(
            "tags",
            normalizedTagValue,
        );

        const cssVars: string[] = [];
        if (background !== "") {
            cssVars.push(`--tag-background: ${background}`);
            cssVars.push(`--tag-background-hover: ${background}`);
        }
        if (text !== "") {
            cssVars.push(`--tag-color: ${text}`);
            cssVars.push(`--tag-color-hover: ${text}`);
        }

        if (cssVars.length === 0) {
            return undefined;
        }

        return cssVars.join("; ");
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

    function addValue(value: string): void {
        const normalizedValue = normalizeInputValue(value);
        if (normalizedValue.length === 0 || editingMode === null) {
            return;
        }

        if (editingMode === "single") {
            editingValues = [normalizedValue];
            editInput = "";
            markChanges();
            return;
        }

        if (editingValues.includes(normalizedValue)) {
            editInput = "";
            return;
        }

        editingValues = [...editingValues, normalizedValue];
        editInput = "";
        markChanges();
    }

    function commitPendingInput(): void {
        const pendingValue = normalizeInputValue(editInput);
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
        });
    }

    function clearEditingState(): void {
        if (suggestTimeout !== null) {
            clearTimeout(suggestTimeout);
            suggestTimeout = null;
        }
        activeModal?.close();
        activeModal = null;
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
            addValue(editInput);
            return;
        }

        if (evt.key === "Backspace" && editInput.trim().length === 0) {
            removeValue(editingValues.length - 1);
            return;
        }

        if (evt.key === "Escape") {
            evt.preventDefault();
            void exitPropertyEditing(false);
            return;
        }

        if (evt.key === "Tab" && evt.shiftKey === false) {
            commitPendingInput();
            return;
        }

        if (evt.key === "ArrowDown" || (evt.ctrlKey && evt.key === " ")) {
            evt.preventDefault();
            openSuggestions();
        }
    }

    function handleRemoveValue(evt: MouseEvent, index: number): void {
        evt.preventDefault();
        evt.stopPropagation();
        removeValue(index);
    }

    function getFilteredSuggestions(propertyId: BasesPropertyId): string[] {
        const allSuggestions = callbacks.card.getPropertySuggestions(propertyId);
        const query = editInput.trim().toLowerCase();
        return allSuggestions.filter((value: string) => {
            const isAlreadySelected = editingValues.includes(value);
            if (isAlreadySelected) {
                return false;
            }
            if (query.length === 0) {
                return true;
            }
            return value.toLowerCase().includes(query);
        });
    }

    function openSuggestions(): void {
        if (editingPropertyId === null) {
            return;
        }

        const suggestions = getFilteredSuggestions(editingPropertyId);
        activeModal?.close();
        activeModal = new PropertyValueSuggestModal({
            app,
            initialQuery: editInput,
            items: suggestions,
            onChoose: (value: string) => {
                addValue(value);
            },
        });
        activeModal.setCloseCallback(() => {
            activeModal = null;
            queueMicrotask(() => {
                propertyInputEl?.focus();
            });
        });
        activeModal.open();
    }

    function scheduleSuggestions(): void {
        if (editingPropertyId === null) {
            return;
        }
        if (suggestTimeout !== null) {
            clearTimeout(suggestTimeout);
        }
        suggestTimeout = setTimeout(() => {
            suggestTimeout = null;
            openSuggestions();
        }, 120);
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

            if (activeModal !== null) {
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
        if (suggestTimeout !== null) {
            clearTimeout(suggestTimeout);
            suggestTimeout = null;
        }
        activeModal?.close();
        activeModal = null;
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
                                class="bases-kanban-property-editor"
                                onclick={handlePropertyEditorClick}
                            >
                                {#each editingValues as value, valueIndex (`${value}-${valueIndex}`)}
                                    {@const chipClass = isTagProperty
                                        ? "bases-kanban-property-value bases-kanban-property-tag bases-kanban-property-chip"
                                        : "bases-kanban-property-value bases-kanban-property-chip"}
                                    <span
                                        class={chipClass}
                                        style={getPrettyTagStyleVars(
                                            value,
                                            isTagProperty,
                                        )}
                                    >
                                        <span>{value}</span>
                                        <button
                                            type="button"
                                            class="bases-kanban-property-remove"
                                            aria-label="Remove value"
                                            onclick={(evt: MouseEvent) =>
                                                handleRemoveValue(
                                                    evt,
                                                    valueIndex,
                                                )}
                                        >
                                            <span
                                                class="bases-kanban-property-remove-icon"
                                                use:setXIcon
                                            ></span>
                                        </button>
                                    </span>
                                {/each}
                                <input
                                    bind:this={propertyInputEl}
                                    class="bases-kanban-property-input"
                                    type="text"
                                    value={editInput}
                                    placeholder="Add value"
                                    oninput={(evt: Event) => {
                                        const target = evt.target;
                                        if (
                                            target instanceof HTMLInputElement
                                        ) {
                                            editInput = target.value;
                                            scheduleSuggestions();
                                        }
                                    }}
                                    onkeydown={handlePropertyInputKeyDown}
                                    onclick={handlePropertyEditorClick}
                                />
                                <button
                                    type="button"
                                    class="bases-kanban-property-suggest"
                                    aria-label="Show suggestions"
                                    onclick={(evt: MouseEvent) => {
                                        evt.preventDefault();
                                        evt.stopPropagation();
                                        openSuggestions();
                                    }}
                                >
                                    +
                                </button>
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
