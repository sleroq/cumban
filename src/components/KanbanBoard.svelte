<script lang="ts">
  import type { BasesEntry, BasesPropertyId, BasesEntryGroup } from "obsidian";
  import { onMount } from "svelte";
  import type { Readable } from "svelte/store";
  import KanbanColumn from "./KanbanColumn.svelte";
  import { createColumnDragState, createCardDragState } from "../kanban-view/drag-state";

  interface Props {
    groups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>;
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    selectedPathsStore: Readable<Set<string>>;
    initialBoardScrollLeft: number;
    initialBoardScrollTop: number;
    columnScrollByKey: Record<string, number>;
    cardTitleSource: "basename" | "filename" | "path";
    cardTitleMaxLength: number;
    propertyValueSeparator: string;
    tagPropertySuffix: string;
    tagSaturation: number;
    tagLightness: number;
    tagAlpha: number;
    columnHeaderWidth: number;
    emptyColumnLabel: string;
    addCardButtonText: string;
    onCreateCard: (groupByProperty: BasesPropertyId | null, groupKey: unknown) => void;
    onCardSelect: (filePath: string, extendSelection: boolean) => void;
    onCardDragStart: (evt: DragEvent, filePath: string, cardIndex: number) => void;
    onCardDragEnd: () => void;
    onCardDrop: (
      evt: DragEvent,
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
    onStartColumnDrag: (evt: DragEvent, columnKey: string) => void;
    onEndColumnDrag: () => void;
    onColumnDrop: (targetKey: string, placement: "before" | "after") => void;
  }

  let {
    groups,
    groupByProperty,
    selectedProperties,
    selectedPathsStore,
    initialBoardScrollLeft,
    initialBoardScrollTop,
    columnScrollByKey,
    cardTitleSource,
    cardTitleMaxLength,
    propertyValueSeparator,
    tagPropertySuffix,
    tagSaturation,
    tagLightness,
    tagAlpha,
    columnHeaderWidth,
    emptyColumnLabel,
    addCardButtonText,
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
  }: Props = $props();

  let boardEl: HTMLElement | null = $state(null);

  // Create drag state instances at board level
  const columnDragState = createColumnDragState();
  const cardDragState = createCardDragState();

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
    onStartColumnDrag(evt, columnKey);
  }

  function handleEndColumnDrag(): void {
    columnDragState.endDrag();
    onEndColumnDrag();
  }

  function handleSetColumnDropTarget(targetKey: string | null, placement: "before" | "after" | null): void {
    columnDragState.setDropTarget(targetKey, placement);
  }

  function handleColumnDrop(targetKey: string, placement: "before" | "after"): void {
    columnDragState.clearDropTarget();
    onColumnDrop(targetKey, placement);
  }

  function handleStartCardDrag(evt: DragEvent, filePath: string, cardIndex: number): void {
    cardDragState.startDrag(filePath, evt.dataTransfer);
    onCardDragStart(evt, filePath, cardIndex);
  }

  function handleEndCardDrag(): void {
    cardDragState.endDrag();
    onCardDragEnd();
  }

  function handleSetCardDropTarget(targetPath: string | null, targetColumnKey: string | null, placement: "before" | "after" | null): void {
    cardDragState.setDropTarget(targetPath, targetColumnKey, placement);
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
  onscroll={handleBoardScroll}
  role="application"
  aria-label="Kanban board"
>
  {#each groups as { group, entries }, idx (getColumnKey(group.key))}
    {@const columnKey = getColumnKey(group.key)}
    {@const groupKey = group.key}
    {@const startIndex = startCardIndexes[idx] ?? 0}
    {@const groupEntries = entries}
    <KanbanColumn
      {columnKey}
      {groupKey}
      entries={groupEntries}
      startCardIndex={startIndex}
      initialScrollTop={columnScrollByKey[columnKey] ?? 0}
      {groupByProperty}
      {selectedProperties}
      {selectedPathsStore}
      {cardTitleSource}
      {cardTitleMaxLength}
      {propertyValueSeparator}
      {tagPropertySuffix}
      {tagSaturation}
      {tagLightness}
      {tagAlpha}
      {columnHeaderWidth}
      {emptyColumnLabel}
      {addCardButtonText}
      {columnDragState}
      {cardDragState}
      onStartColumnDrag={handleStartColumnDrag}
      onEndColumnDrag={handleEndColumnDrag}
      onSetColumnDropTarget={handleSetColumnDropTarget}
      onColumnDrop={handleColumnDrop}
      onCreateCard={() => onCreateCard(groupByProperty, group.key)}
      onCardSelect={onCardSelect}
      onCardDragStart={handleStartCardDrag}
      onCardDragEnd={handleEndCardDrag}
      onSetCardDropTarget={handleSetCardDropTarget}
      onCardDrop={onCardDrop}
      onCardContextMenu={onCardContextMenu}
      onCardLinkClick={onCardLinkClick}
      onCardsScroll={(scrollTop) => onCardsScroll(columnKey, scrollTop)}
    />
  {/each}
</div>
