<script lang="ts">
    import { getContext } from "svelte";
    import { setIcon, type BasesEntry } from "obsidian";
    import { onDestroy, onMount } from "svelte";
    import KanbanCard from "./KanbanCard.svelte";
    import { getColumnName } from "../kanban-view/utils";
    import {
        KANBAN_BOARD_CONTEXT_KEY,
        type KanbanBoardContext,
    } from "../kanban-view/board-context";
    import { KANBAN_CONTEXT_KEY } from "../kanban-view/context";
    import type { KanbanContext } from "../kanban-view/context";
    import { flip } from "svelte/animate";

    type Props = {
        columnKey: string;
        groupKey: unknown;
        entries: BasesEntry[];
        startCardIndex: number;
        initialScrollTop: number;
        isPinned: boolean;
        onStartColumnDrag: (evt: DragEvent, columnKey: string) => void;
        onEndColumnDrag: () => void;
        onSetColumnDropTarget: (
            targetKey: string | null,
            placement: "before" | "after" | null,
        ) => void;
        onColumnDrop: (
            targetKey: string,
            placement: "before" | "after",
        ) => void;
        onStartCardDrag: (
            evt: DragEvent,
            filePath: string,
            cardIndex: number,
        ) => void;
        onEndCardDrag: () => void;
        onSetCardDropTarget: (
            targetPath: string | null,
            targetColumnKey: string | null,
            placement: "before" | "after" | null,
        ) => void;
        onCardDrop: (
            filePath: string | null,
            groupKey: unknown,
            placement: "before" | "after",
        ) => void;
    };

    let {
        columnKey,
        groupKey,
        entries,
        startCardIndex,
        initialScrollTop,
        isPinned,
        onStartColumnDrag,
        onEndColumnDrag,
        onSetColumnDropTarget,
        onColumnDrop,
        onStartCardDrag,
        onEndCardDrag,
        onSetCardDropTarget,
        onCardDrop,
    }: Props = $props();

    const { settingsStore, animationsReadyStore } =
        getContext<KanbanContext>(KANBAN_CONTEXT_KEY);
    const boardContext = getContext<KanbanBoardContext>(
        KANBAN_BOARD_CONTEXT_KEY,
    );
    const settings = $derived($settingsStore);
    const animationsReady = $derived($animationsReadyStore);
    const groupByProperty = $derived(boardContext.groupByProperty);
    const callbacks = $derived(boardContext.callbacks);
    const dragState = boardContext.dragState;

    let columnEl: HTMLElement | null = $state(null);
    let cardsEl: HTMLElement | null = $state(null);
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
    let columnRafId: number | null = null;

    function conditionalFlip(
        node: Element,
        { from, to }: { from: DOMRect; to: DOMRect },
        options?: { delay?: number; duration?: number | ((len: number) => number); easing?: (t: number) => number },
    ): { delay?: number; duration?: number; easing?: (t: number) => number; css?: (t: number, u: number) => string; tick?: (t: number, u: number) => void } {
        if (!settings.enableAnimations || !animationsReady) {
            return { duration: 0 };
        }
        return flip(node, { from, to }, options);
    }

    const columnName = $derived(
        getColumnName(groupKey, settings.emptyColumnLabel),
    );
    let isEditingColumnName = $state(false);
    let editingColumnName = $state("");
    let columnNameInputEl: HTMLInputElement | null = $state(null);
    let isSubmittingColumnRename = $state(false);

    const columnIsDragging = $derived(dragState.isColumnDragging);
    const cardIsDragging = $derived(dragState.isCardDragging);

    const isDropTargetBefore = $derived(
        dragState.columnDropTargetStore(columnKey),
    );
    const dropPlacement = $derived(
        dragState.columnDropPlacementStore(columnKey),
    );
    const isDraggingSourceColumn = $derived(
        dragState.columnSourceStore(columnKey),
    );

    onMount(() => {
        if (cardsEl !== null && initialScrollTop > 0) {
            cardsEl.scrollTop = initialScrollTop;
        }
    });

    onDestroy(() => {
        if (scrollTimeout !== null) {
            clearTimeout(scrollTimeout);
        }
        if (columnRafId !== null) {
            cancelAnimationFrame(columnRafId);
        }
    });

    function setPinIcon(
        node: HTMLElement,
        pinned: boolean,
    ): { update: (nextPinned: boolean) => void; destroy: () => void } {
        function updateIcon(nextPinned: boolean): void {
            node.empty();
            setIcon(node, nextPinned ? "pin-off" : "pin");
        }

        updateIcon(pinned);

        return {
            update(nextPinned: boolean) {
                updateIcon(nextPinned);
            },
            destroy() {},
        };
    }

    function getFirstCardPath(): string | null {
        const firstEntry = entries[0];
        if (firstEntry === undefined) {
            return null;
        }
        return firstEntry.file.path;
    }

    function handleHeaderCardDragOver(evt: DragEvent): void {
        if (groupByProperty === null || !$cardIsDragging) {
            return;
        }
        evt.preventDefault();
        evt.stopPropagation();

        const firstCardPath = getFirstCardPath();
        if (firstCardPath === null) {
            onSetCardDropTarget(null, null, null);
            return;
        }
        onSetCardDropTarget(firstCardPath, columnKey, "before");
    }

    function handleHeaderCardDrop(evt: DragEvent): void {
        if (groupByProperty === null || !$cardIsDragging) {
            return;
        }
        evt.preventDefault();
        evt.stopPropagation();

        const firstCardPath = getFirstCardPath();
        onSetCardDropTarget(null, null, null);
        onCardDrop(firstCardPath, groupKey, "before");
    }

    function getCardInsertionTarget(mouseY: number): {
        targetPath: string | null;
        placement: "before" | "after";
    } {
        if (cardsEl === null) {
            return { targetPath: null, placement: "after" };
        }

        const cards = cardsEl.querySelectorAll(".bases-kanban-card");
        if (cards.length === 0) {
            return { targetPath: null, placement: "after" };
        }

        for (const card of Array.from(cards)) {
            const rect = card.getBoundingClientRect();
            const cardMiddle = rect.top + rect.height / 2;
            if (mouseY < cardMiddle) {
                return {
                    targetPath: card.getAttribute("data-card-path"),
                    placement: "before",
                };
            }
        }

        const lastCard = cards.item(cards.length - 1);
        return {
            targetPath: lastCard?.getAttribute("data-card-path") ?? null,
            placement: "after",
        };
    }

    function beginColumnRename(evt: Event): void {
        evt.preventDefault();
        evt.stopPropagation();
        if (isEditingColumnName) {
            return;
        }
        editingColumnName = columnName;
        isEditingColumnName = true;
        queueMicrotask(() => {
            columnNameInputEl?.focus();
            columnNameInputEl?.select();
        });
    }

    function cancelColumnRename(): void {
        if (isSubmittingColumnRename) {
            return;
        }
        isEditingColumnName = false;
        editingColumnName = "";
    }

    async function submitColumnRename(): Promise<void> {
        if (isSubmittingColumnRename) {
            return;
        }
        const nextName = editingColumnName.trim();
        if (nextName.length === 0 || nextName === columnName) {
            cancelColumnRename();
            return;
        }

        isSubmittingColumnRename = true;
        try {
            await callbacks.column.rename(columnKey, groupKey, nextName);
            isEditingColumnName = false;
            editingColumnName = "";
        } finally {
            isSubmittingColumnRename = false;
        }
    }
</script>

<div
    bind:this={columnEl}
    class="bases-kanban-column"
    class:bases-kanban-column-drop-before={$isDropTargetBefore &&
        $dropPlacement === "before"}
    class:bases-kanban-column-drop-after={$isDropTargetBefore &&
        $dropPlacement === "after"}
    class:bases-kanban-column-dragging={$isDraggingSourceColumn}
    data-column-key={columnKey}
    style:--bases-kanban-column-header-width="{settings.columnHeaderWidth}px"
    ondragover={(evt) => {
        if (!$columnIsDragging) return;
        evt.preventDefault();
        if (columnRafId !== null) {
            cancelAnimationFrame(columnRafId);
        }
        columnRafId = requestAnimationFrame(() => {
            columnRafId = null;
            if (columnEl !== null) {
                const rect = columnEl.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                const placement = evt.clientX < midX ? "before" : "after";
                onSetColumnDropTarget(columnKey, placement);
            }
        });
    }}
    ondragleave={(evt) => {
        const relatedTarget = evt.relatedTarget as Node | null;
        if (relatedTarget === null) {
            return;
        }
        if (columnEl !== null && columnEl.contains(relatedTarget)) {
            return;
        }
        onSetColumnDropTarget(null, null);
    }}
    ondrop={(evt) => {
        if (!$columnIsDragging) return;
        evt.preventDefault();
        if (columnRafId !== null) {
            cancelAnimationFrame(columnRafId);
            columnRafId = null;
        }
        const placement =
            dragState.getColumnDropPlacement(columnKey) ?? "before";
        onSetColumnDropTarget(null, null);
        onColumnDrop(columnKey, placement);
    }}
    role="region"
>
    <div
        class="bases-kanban-column-header"
        draggable={!isEditingColumnName}
        role="button"
        tabindex="0"
        onclick={(evt) => {
            const target = evt.target as HTMLElement;
            if (
                target.closest(".bases-kanban-column-name-display") === null ||
                target.closest(".bases-kanban-pin-button") !== null ||
                target.closest(".bases-kanban-add-card-button") !== null ||
                target.closest(".bases-kanban-column-name-input") !== null
            ) {
                return;
            }
            beginColumnRename(evt);
        }}
        onkeydown={(evt) => {
            if (evt.key !== "Enter" && evt.key !== " ") {
                return;
            }
            const target = evt.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (
                target.closest(".bases-kanban-column-name-display") === null ||
                target.closest(".bases-kanban-pin-button") !== null ||
                target.closest(".bases-kanban-add-card-button") !== null ||
                target.closest(".bases-kanban-column-name-input") !== null
            ) {
                return;
            }
            beginColumnRename(evt);
        }}
        ondragover={handleHeaderCardDragOver}
        ondrop={handleHeaderCardDrop}
        ondragstart={(evt) => {
            if (isEditingColumnName) {
                evt.preventDefault();
                return;
            }
            const target = evt.target as HTMLElement;
            if (target.closest(".bases-kanban-add-card-button") !== null) {
                evt.preventDefault();
                return;
            }
            onStartColumnDrag(evt, columnKey);
        }}
        ondragend={() => {
            if (columnRafId !== null) {
                cancelAnimationFrame(columnRafId);
                columnRafId = null;
            }
            onEndColumnDrag();
        }}
    >
        <div class="bases-kanban-column-handle">
            {#if isEditingColumnName}
                <input
                    bind:this={columnNameInputEl}
                    class="bases-kanban-column-name-input"
                    type="text"
                    value={editingColumnName}
                    style:width="{settings.columnHeaderWidth}px"
                    onmousedown={(evt) => evt.stopPropagation()}
                    onclick={(evt) => evt.stopPropagation()}
                    oninput={(evt) => {
                        const target = evt.target;
                        if (!(target instanceof HTMLInputElement)) {
                            return;
                        }
                        editingColumnName = target.value;
                    }}
                    onkeydown={(evt) => {
                        if (evt.key === "Enter") {
                            evt.preventDefault();
                            void submitColumnRename();
                            return;
                        }
                        if (evt.key === "Escape") {
                            evt.preventDefault();
                            cancelColumnRename();
                        }
                    }}
                    onblur={() => {
                        void submitColumnRename();
                    }}
                />
            {:else}
                <div
                    class="bases-kanban-column-name-display"
                    style:width="{settings.columnHeaderWidth}px"
                >
                    <h3>{columnName}</h3>
                    <span
                        class="bases-kanban-column-edit-indicator"
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
                </div>
            {/if}
        </div>
        <span class="bases-kanban-column-count">{entries.length}</span>
        <button
            type="button"
            class="bases-kanban-pin-button"
            draggable="false"
            aria-label={isPinned ? "Unpin column" : "Pin column"}
            onmousedown={(evt) => evt.stopPropagation()}
            onclick={(evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                callbacks.column.togglePin(columnKey);
            }}
            use:setPinIcon={isPinned}
        >
        </button>
        <button
            type="button"
            class="bases-kanban-add-card-button"
            draggable="false"
            onmousedown={(evt) => evt.stopPropagation()}
            onclick={(evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                callbacks.column.createCard(groupByProperty, groupKey);
            }}
        >
            {settings.addCardButtonText}
        </button>
    </div>

    <div
        bind:this={cardsEl}
        class="bases-kanban-cards"
        ondragover={(evt) => {
            if (groupByProperty === null || !$cardIsDragging) return;
            evt.preventDefault();

            if (cardsEl === null) return;

            const target = evt.target as HTMLElement;
            const isOnCard = target.closest(".bases-kanban-card") !== null;
            if (isOnCard) {
                return;
            }

            const { targetPath, placement } = getCardInsertionTarget(
                evt.clientY,
            );
            if (targetPath === null) {
                onSetCardDropTarget(null, null, null);
                return;
            }
            onSetCardDropTarget(targetPath, columnKey, placement);
        }}
        ondrop={(evt) => {
            evt.preventDefault();
            const dropTarget = evt.target as HTMLElement;
            const isDropOnContainer =
                dropTarget === cardsEl ||
                (dropTarget !== null &&
                    dropTarget.classList?.contains("bases-kanban-cards"));
            if (!isDropOnContainer) {
                return;
            }
            const { targetPath, placement } = getCardInsertionTarget(
                evt.clientY,
            );
            onSetCardDropTarget(null, null, null);
            onCardDrop(targetPath, groupKey, placement);
        }}
        onscroll={() => {
            if (cardsEl === null) return;
            if (scrollTimeout !== null) {
                clearTimeout(scrollTimeout);
            }
            scrollTimeout = setTimeout(() => {
                callbacks.column.cardsScroll(columnKey, cardsEl!.scrollTop);
            }, 100);
        }}
        role="list"
    >
        {#each entries as entry, i (entry.file.path)}
            {@const cardIndex = startCardIndex + i}
            <div animate:conditionalFlip={{ duration: 100 }}>
                <KanbanCard
                    {entry}
                    {columnKey}
                    {groupKey}
                    {cardIndex}
                    onDragStart={onStartCardDrag}
                    onDragEnd={onEndCardDrag}
                    onSetDropTarget={onSetCardDropTarget}
                    onDrop={onCardDrop}
                />
            </div>
        {/each}
    </div>
</div>
