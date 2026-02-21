<script lang="ts">
  import type { BasesEntry, BasesPropertyId, BasesEntryGroup } from "obsidian";
  import { onMount } from "svelte";
  import KanbanColumn from "./KanbanColumn.svelte";
  import { createColumnDragState, createCardDragState } from "../kanban-view/drag-state";

  interface Props {
    groups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>;
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    initialBoardScrollLeft: number;
    initialBoardScrollTop: number;
    columnScrollByKey: Record<string, number>;
    pinnedColumns: Set<string>;
    onCreateCard: (groupByProperty: BasesPropertyId | null, groupKey: unknown) => void;
    onCardSelect: (filePath: string, extendSelection: boolean) => void;
    onCardDragStart: (filePath: string, cardIndex: number) => void;
    onCardDragEnd: () => void;
    onCardDrop: (
      sourcePath: string | null,
      filePath: string | null,
      groupKey: unknown,
      placement: "before" | "after",
    ) => void;
    onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) => void;
    onCardLinkClick: (evt: MouseEvent, target: string) => void;
    onCardsScroll: (columnKey: string, scrollTop: number) => void;
    onBoardScroll: (scrollLeft: number, scrollTop: number) => void;
    onBoardKeyDown: (evt: KeyboardEvent) => void;
    onBoardClick: () => void;
    onStartColumnDrag: (columnKey: string) => void;
    onEndColumnDrag: () => void;
    onColumnDrop: (sourceKey: string | null, targetKey: string, placement: "before" | "after") => void;
    onTogglePin: (columnKey: string) => void;
  }

  let {
    groups,
    groupByProperty,
    selectedProperties,
    initialBoardScrollLeft,
    initialBoardScrollTop,
    columnScrollByKey,
    pinnedColumns,
    onCreateCard,
    onCardSelect,
    onCardDragStart,
    onCardDragEnd,
    onCardDrop,
    onCardContextMenu,
    onCardLinkClick,
    onCardsScroll,
    onBoardScroll,
    onBoardKeyDown,
    onBoardClick,
    onStartColumnDrag,
    onEndColumnDrag,
    onColumnDrop,
    onTogglePin,
  }: Props = $props();

  let boardEl: HTMLElement | null = $state(null);

  // Create drag state instances at board level
  const columnDragState = createColumnDragState();
  const cardDragState = createCardDragState();
  const columnSourceKeyStore = $derived(columnDragState.sourceKey);
  const cardSourcePathStore = $derived(cardDragState.sourcePath);

  function getColumnKey(groupKey: unknown): string {
    if (groupKey === undefined || groupKey === null) {
      return "__bases_kanban_no_value__";
    }
    return String(groupKey);
  }

  function handleBoardScroll(): void {
    if (boardEl === null) return;
    onBoardScroll(boardEl.scrollLeft, boardEl.scrollTop);
  }

  function handleBoardClick(evt: MouseEvent): void {
    if ((evt.target as HTMLElement).closest(".bases-kanban-card") !== null) {
      return;
    }
    onBoardClick();
  }

  // Wrapper functions that include drag state
  function handleStartColumnDrag(evt: DragEvent, columnKey: string): void {
    columnDragState.startDrag(columnKey, evt.dataTransfer);
    onStartColumnDrag(columnKey);
  }

  function handleEndColumnDrag(): void {
    columnDragState.endDrag();
    onEndColumnDrag();
  }

  function handleSetColumnDropTarget(targetKey: string | null, placement: "before" | "after" | null): void {
    columnDragState.setDropTarget(targetKey, placement);
  }

  function handleColumnDrop(targetKey: string, placement: "before" | "after"): void {
    const sourceColumnKey = $columnSourceKeyStore;
    columnDragState.clearDropTarget();
    onColumnDrop(sourceColumnKey, targetKey, placement);
  }

  function handleStartCardDrag(evt: DragEvent, filePath: string, cardIndex: number): void {
    cardDragState.startDrag(filePath, evt.dataTransfer);
    onCardDragStart(filePath, cardIndex);
  }

  function handleEndCardDrag(): void {
    cardDragState.endDrag();
    onCardDragEnd();
  }

  function handleSetCardDropTarget(targetPath: string | null, targetColumnKey: string | null, placement: "before" | "after" | null): void {
    cardDragState.setDropTarget(targetPath, targetColumnKey, placement);
  }

  function handleCardDrop(
    filePath: string | null,
    groupKey: unknown,
    placement: "before" | "after",
  ): void {
    onCardDrop($cardSourcePathStore, filePath, groupKey, placement);
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
    boardEl.scrollLeft = initialBoardScrollLeft;
    boardEl.scrollTop = initialBoardScrollTop;
    // Use passive listener for better scroll performance
    boardEl.addEventListener("scroll", handleBoardScroll, { passive: true });
    return () => {
      boardEl?.removeEventListener("scroll", handleBoardScroll);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={boardEl}
  class="bases-kanban-board"
  data-keyboard-bound="true"
  tabindex="0"
  onkeydown={onBoardKeyDown}
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
      {groupByProperty}
      {selectedProperties}
      {columnDragState}
      {cardDragState}
      {isPinned}
      onStartColumnDrag={handleStartColumnDrag}
      onEndColumnDrag={handleEndColumnDrag}
      onSetColumnDropTarget={handleSetColumnDropTarget}
      onColumnDrop={handleColumnDrop}
      onCreateCard={() => onCreateCard(groupByProperty, group.key)}
      onCardSelect={onCardSelect}
      onCardDragStart={handleStartCardDrag}
      onCardDragEnd={handleEndCardDrag}
      onSetCardDropTarget={handleSetCardDropTarget}
      onCardDrop={handleCardDrop}
      onCardContextMenu={onCardContextMenu}
      onCardLinkClick={onCardLinkClick}
      onCardsScroll={(scrollTop) => onCardsScroll(columnKey, scrollTop)}
      onTogglePin={() => onTogglePin(columnKey)}
    />
  {/each}
</div>
