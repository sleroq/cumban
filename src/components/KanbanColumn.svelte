<script lang="ts">
  import type { BasesEntry, BasesPropertyId } from "obsidian";
  import { onDestroy, onMount } from "svelte";
  import type { Readable } from "svelte/store";
  import KanbanCard from "./KanbanCard.svelte";
  import { getColumnName } from "../kanban-view/utils";
  import type { createCardDragState, createColumnDragState } from "../kanban-view/drag-state";

  interface Props {
    columnKey: string;
    groupKey: unknown;
    entries: BasesEntry[];
    startCardIndex: number;
    initialScrollTop: number;
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    selectedPathsStore: Readable<Set<string>>;
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
    columnDragState: ReturnType<typeof createColumnDragState>;
    cardDragState: ReturnType<typeof createCardDragState>;
    onStartColumnDrag: (evt: DragEvent, columnKey: string) => void;
    onEndColumnDrag: () => void;
    onSetColumnDropTarget: (targetKey: string | null, placement: "before" | "after" | null) => void;
    onColumnDrop: (targetKey: string, placement: "before" | "after") => void;
    onCreateCard: () => void;
    onCardSelect: (filePath: string, extendSelection: boolean) => void;
    onCardDragStart: (evt: DragEvent, filePath: string, cardIndex: number) => void;
    onCardDragEnd: () => void;
    onSetCardDropTarget: (targetPath: string | null, targetColumnKey: string | null, placement: "before" | "after" | null) => void;
    onCardDrop: (
      evt: DragEvent,
      filePath: string | null,
      groupKey: unknown,
      placement: "before" | "after",
    ) => void;
    onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) => void;
    onCardLinkClick: (evt: MouseEvent, target: string) => void;
    onCardsScroll: (scrollTop: number) => void;
  }

  let {
    columnKey,
    groupKey,
    entries,
    startCardIndex,
    initialScrollTop,
    groupByProperty,
    selectedProperties,
    selectedPathsStore,
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
    columnDragState,
    cardDragState,
    onStartColumnDrag,
    onEndColumnDrag,
    onSetColumnDropTarget,
    onColumnDrop,
    onCreateCard,
    onCardSelect,
    onCardDragStart,
    onCardDragEnd,
    onSetCardDropTarget,
    onCardDrop,
    onCardContextMenu,
    onCardLinkClick,
    onCardsScroll,
  }: Props = $props();

  let columnEl: HTMLElement | null = $state(null);
  let cardsEl: HTMLElement | null = $state(null);
  let scrollTimeout: ReturnType<typeof setTimeout> | null = $state(null);

  const columnName = $derived(getColumnName(groupKey, emptyColumnLabel));

  // Extract stores to local variables so we can use $ prefix
  const columnIsDragging = $derived(columnDragState.isDragging);
  const cardIsDragging = $derived(cardDragState.isDragging);

  onMount(() => {
    if (cardsEl !== null && initialScrollTop > 0) {
      cardsEl.scrollTop = initialScrollTop;
    }
  });

  onDestroy(() => {
    if (scrollTimeout !== null) {
      clearTimeout(scrollTimeout);
    }
  });
</script>

<div
  bind:this={columnEl}
  class="bases-kanban-column"
  class:bases-kanban-column-drop-before={columnDragState.isDropTarget(columnKey) && columnDragState.getDropPlacement(columnKey) === "before"}
  class:bases-kanban-column-drop-after={columnDragState.isDropTarget(columnKey) && columnDragState.getDropPlacement(columnKey) === "after"}
  data-column-key={columnKey}
  style:--bases-kanban-column-header-width="{columnHeaderWidth}px"
  ondragover={(evt) => {
    if (!$columnIsDragging) return;
    evt.preventDefault();
    if (columnEl !== null) {
      const rect = columnEl.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const placement = evt.clientX < midX ? "before" : "after";
      onSetColumnDropTarget(columnKey, placement);
    }
  }}
  ondragleave={(evt) => {
    const relatedTarget = evt.relatedTarget as Node | null;
    // Don't clear drop target if relatedTarget is null - HTML5 DnD fires dragleave
    // with null relatedTarget frequently. Only clear when moving to a different element.
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
    const placement = columnDragState.getDropPlacement(columnKey) ?? "before";
    onSetColumnDropTarget(null, null);
    onColumnDrop(columnKey, placement);
  }}
  role="region"
  aria-label={columnName}
>
  <div
    class="bases-kanban-column-header"
  >
    <div
      class="bases-kanban-column-handle"
      draggable="true"
      ondragstart={(evt) => onStartColumnDrag(evt, columnKey)}
      ondragend={onEndColumnDrag}
      role="button"
      tabindex="0"
      aria-label="Drag to reorder column"
    >
      <h3 style:width="{columnHeaderWidth}px">{columnName}</h3>
    </div>
    <span class="bases-kanban-column-count">{entries.length}</span>
    <button
      type="button"
      class="bases-kanban-add-card-button"
      aria-label="Add card to {columnName}"
      draggable="false"
      onmousedown={(evt) => evt.stopPropagation()}
      onclick={(evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        onCreateCard();
      }}
    >
      {addCardButtonText}
    </button>
  </div>

  <div
    bind:this={cardsEl}
    class="bases-kanban-cards"
    class:bases-kanban-drop-target={cardDragState.isDropTargetInColumn(columnKey)}
    ondragover={(evt) => {
      if (groupByProperty === null || !$cardIsDragging) return;
      evt.preventDefault();
    }}
    ondrop={(evt) => {
      evt.preventDefault();
      // Check if drop actually occurred on the cards container (empty space)
      // versus bubbling up from a card element. The target is the element
      // that received the drop, which could be the container or a card.
      const dropTarget = evt.target as HTMLElement;
      const isDropOnContainer = dropTarget === cardsEl ||
        (dropTarget !== null && dropTarget.classList?.contains("bases-kanban-cards"));
      if (!isDropOnContainer) {
        // Drop was on a card element - let the card's drop handler handle this
        return;
      }
      // Empty space drop - clear any stale card target and use column's group key
      onSetCardDropTarget(null, null, null);
      const placement = cardDragState.getPlacement() ?? "after";
      onCardDrop(evt, null, groupKey, placement);
    }}
    onscroll={() => {
      if (cardsEl === null) return;
      if (scrollTimeout !== null) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = setTimeout(() => {
        onCardsScroll(cardsEl!.scrollTop);
      }, 100);
    }}
    role="list"
  >
    {#each entries as entry, i (entry.file.path)}
      {@const filePath = entry.file.path}
      {@const cardIndex = startCardIndex + i}
      <KanbanCard
        {entry}
        {columnKey}
        {groupKey}
        {cardIndex}
        {groupByProperty}
        {selectedProperties}
        selected={$selectedPathsStore.has(filePath)}
        {cardTitleSource}
        {cardTitleMaxLength}
        {propertyValueSeparator}
        {tagPropertySuffix}
        {tagSaturation}
        {tagLightness}
        {tagAlpha}
        {cardDragState}
        onSelect={onCardSelect}
        onDragStart={onCardDragStart}
        onDragEnd={onCardDragEnd}
        onSetDropTarget={onSetCardDropTarget}
        onDrop={onCardDrop}
        onContextMenu={(evt) => onCardContextMenu(evt, entry)}
        onLinkClick={onCardLinkClick}
      />
    {/each}
  </div>
</div>
