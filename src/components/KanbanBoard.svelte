<script lang="ts">
    import type {
        BasesEntry,
        BasesPropertyId,
        BasesEntryGroup,
    } from "obsidian";
    import { setContext } from "svelte";
    import { onMount } from "svelte";
    import KanbanColumn from "./KanbanColumn.svelte";

    import type { KanbanCallbacks } from "../kanban-view/actions";
    import {
        KANBAN_BOARD_CONTEXT_KEY,
        type KanbanBoardContext,
    } from "../kanban-view/board-context";
    import { createKanbanDragState } from "../kanban-view/drag-state";
    import { getColumnKey } from "../kanban-view/utils";

    type Props = {
        groups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>;
        groupByProperty: BasesPropertyId | null;
        selectedProperties: BasesPropertyId[];
        initialBoardScrollLeft: number;
        initialBoardScrollTop: number;
        columnScrollByKey: Record<string, number>;
        pinnedColumns: Set<string>;
        columnsRightToLeft: boolean;
        callbacks: KanbanCallbacks;
    };

    let {
        groups,
        groupByProperty,
        selectedProperties,
        initialBoardScrollLeft,
        initialBoardScrollTop,
        columnScrollByKey,
        pinnedColumns,
        columnsRightToLeft,
        callbacks,
    }: Props = $props();

    let boardEl: HTMLElement | null = $state(null);
    let suppressScrollEvents = $state(true);
    let clearSuppressionRafId: number | null = null;
    let activePropertyEditorFilePath: string | null = null;
    let activePropertyEditorClose: (() => Promise<void>) | null = null;
    let activePropertyEditorContainsTarget: ((target: Node) => boolean) | null =
        null;

    // Create unified drag state at board level
    const dragState = createKanbanDragState();
    const columnSourceKeyStore = $derived(dragState.columnSourceKey);
    const cardSourcePathStore = $derived(dragState.cardSourcePath);

    const boardContextValue: KanbanBoardContext = $state({
        get groupByProperty() {
            return groupByProperty;
        },
        get selectedProperties() {
            return selectedProperties;
        },
        get dragState() {
            return dragState;
        },
        get callbacks() {
            return callbacks;
        },
        setActivePropertyEditor(
            filePath: string,
            close: () => Promise<void>,
            isTargetInsideEditor: (target: Node) => boolean,
        ) {
            activePropertyEditorFilePath = filePath;
            activePropertyEditorClose = close;
            activePropertyEditorContainsTarget = isTargetInsideEditor;
        },
        clearActivePropertyEditor(filePath: string) {
            if (activePropertyEditorFilePath !== filePath) {
                return;
            }
            activePropertyEditorFilePath = null;
            activePropertyEditorClose = null;
            activePropertyEditorContainsTarget = null;
        },
    });
    setContext(KANBAN_BOARD_CONTEXT_KEY, boardContextValue);

    function handleDocumentMouseDown(evt: MouseEvent): void {
        const target = evt.target;
        if (!(target instanceof Node)) {
            return;
        }
        if (
            activePropertyEditorContainsTarget !== null &&
            activePropertyEditorContainsTarget(target)
        ) {
            return;
        }
        void activePropertyEditorClose?.();
    }

    function handleBoardScroll(): void {
        if (boardEl === null || suppressScrollEvents) return;
        callbacks.board.scroll(boardEl.scrollLeft, boardEl.scrollTop);
    }

    function handleBoardClick(evt: MouseEvent): void {
        if (
            (evt.target as HTMLElement).closest(".bases-kanban-card") !== null
        ) {
            return;
        }
        callbacks.board.click();
    }

    function handleAddColumnClick(evt: MouseEvent): void {
        evt.preventDefault();
        evt.stopPropagation();
        callbacks.board.addColumn();
    }

    // Wrapper functions that include drag state
    function handleStartColumnDrag(evt: DragEvent, columnKey: string): void {
        dragState.startColumnDrag(columnKey, evt.dataTransfer);
        callbacks.column.startDrag(columnKey);
    }

    function handleEndColumnDrag(): void {
        dragState.endDrag();
        callbacks.column.endDrag();
    }

    function handleSetColumnDropTarget(
        targetKey: string | null,
        placement: "before" | "after" | null,
    ): void {
        dragState.setColumnDropTarget(targetKey, placement);
    }

    function handleColumnDrop(
        targetKey: string,
        placement: "before" | "after",
    ): void {
        const sourceColumnKey = $columnSourceKeyStore;
        dragState.clearDropTarget();
        callbacks.column.drop(sourceColumnKey, targetKey, placement);
    }

    function handleStartCardDrag(
        evt: DragEvent,
        filePath: string,
        cardIndex: number,
    ): void {
        dragState.startCardDrag(filePath, evt.dataTransfer);
        callbacks.card.dragStart(filePath, cardIndex);
    }

    function handleEndCardDrag(): void {
        dragState.endDrag();
        callbacks.card.dragEnd();
    }

    function handleSetCardDropTarget(
        targetPath: string | null,
        targetColumnKey: string | null,
        placement: "before" | "after" | null,
    ): void {
        dragState.setCardDropTarget(targetPath, targetColumnKey, placement);
    }

    function handleCardDrop(
        filePath: string | null,
        groupKey: unknown,
        placement: "before" | "after",
    ): void {
        callbacks.card.drop($cardSourcePathStore, filePath, groupKey, placement);
    }

    const startCardIndexes = $derived.by(() => {
        let runningTotal = 0;
        return groups.map(({ entries }) => {
            const start = runningTotal;
            runningTotal += entries.length;
            return start;
        });
    });

    onMount(() => {
        if (boardEl === null) {
            return;
        }

        suppressScrollEvents = true;
        boardEl.scrollLeft = initialBoardScrollLeft;
        boardEl.scrollTop = initialBoardScrollTop;

        clearSuppressionRafId = requestAnimationFrame(() => {
            clearSuppressionRafId = requestAnimationFrame(() => {
                suppressScrollEvents = false;
                clearSuppressionRafId = null;
            });
        });

        // Use passive listener for better scroll performance
        boardEl.addEventListener("scroll", handleBoardScroll, {
            passive: true,
        });
        document.addEventListener("mousedown", handleDocumentMouseDown, true);
        return () => {
            if (clearSuppressionRafId !== null) {
                cancelAnimationFrame(clearSuppressionRafId);
                clearSuppressionRafId = null;
            }
            suppressScrollEvents = true;
            boardEl?.removeEventListener("scroll", handleBoardScroll);
            document.removeEventListener(
                "mousedown",
                handleDocumentMouseDown,
                true,
            );
            activePropertyEditorFilePath = null;
            activePropertyEditorClose = null;
            activePropertyEditorContainsTarget = null;
        };
    });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    bind:this={boardEl}
    class="bases-kanban-board"
    style:flex-direction={columnsRightToLeft ? "row-reverse" : "row"}
    data-keyboard-bound="true"
    tabindex="0"
    onkeydown={callbacks.board.keyDown}
    onclick={handleBoardClick}
    role="application"
>
    {#each groups as { group, entries }, idx (getColumnKey(group.key))}
        {@const columnKey = getColumnKey(group.key)}
        {@const groupKey = group.key}
        {@const startIndex = startCardIndexes[idx] ?? 0}
        {@const groupEntries = entries}
        {@const isPinned = pinnedColumns.has(columnKey)}
        <KanbanColumn
            {columnKey}
            {groupKey}
            entries={groupEntries}
            startCardIndex={startIndex}
            initialScrollTop={columnScrollByKey[columnKey] ?? 0}
            {isPinned}
            onStartColumnDrag={handleStartColumnDrag}
            onEndColumnDrag={handleEndColumnDrag}
            onSetColumnDropTarget={handleSetColumnDropTarget}
            onColumnDrop={handleColumnDrop}
            onStartCardDrag={handleStartCardDrag}
            onEndCardDrag={handleEndCardDrag}
            onSetCardDropTarget={handleSetCardDropTarget}
            onCardDrop={handleCardDrop}
        />
    {/each}
    <button
        type="button"
        class="bases-kanban-add-column-button"
        aria-label="Add new column"
        title="Add new column"
        onclick={handleAddColumnClick}
    >
        +
    </button>
</div>
