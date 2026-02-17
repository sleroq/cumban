<script lang="ts">
  import type { BasesEntry, BasesPropertyId } from "obsidian";
  import KanbanCard from "./KanbanCard.svelte";
  import { getColumnName } from "../kanban-view/utils";
  import type { createCardDragState, createColumnDragState } from "../kanban-view/drag-state";

  interface Props {
    columnKey: string;
    groupKey: unknown;
    entries: BasesEntry[];
    startCardIndex: number;
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    selectedPaths: Set<string>;
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
    onSetCardDropTarget: (targetPath: string | null, placement: "before" | "after" | null) => void;
    onCardDrop: (evt: DragEvent, filePath: string | null, groupKey: unknown) => void;
    onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) => void;
    onCardLinkClick: (evt: MouseEvent, target: string) => void;
    onCardsScroll: (scrollTop: number) => void;
    onBoardKeyDown: (evt: KeyboardEvent) => void;
    onBoardClick: (evt: MouseEvent) => void;
  }

  let {
    columnKey,
    groupKey,
    entries,
    startCardIndex,
    groupByProperty,
    selectedProperties,
    selectedPaths,
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
    onBoardKeyDown,
    onBoardClick,
  }: Props = $props();

  let columnEl: HTMLElement | null = $state(null);
  let cardsEl: HTMLElement | null = $state(null);
  let scrollTimeout: ReturnType<typeof setTimeout> | null = $state(null);

  const columnName = getColumnName(groupKey, emptyColumnLabel);

  // Extract stores to local variables so we can use $ prefix
  const columnIsDragging = columnDragState.isDragging;
  const cardTargetPath = cardDragState.targetPath;
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
    if (columnEl !== null && relatedTarget !== null && columnEl.contains(relatedTarget)) {
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
    class:bases-kanban-drop-target={$cardTargetPath !== null}
    ondragover={(evt) => {
      if (groupByProperty === null || !cardDragState.isDragging()) return;
      evt.preventDefault();
    }}
    ondrop={(evt) => {
      evt.preventDefault();
      onCardDrop(evt, null, groupKey);
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
        {groupKey}
        {cardIndex}
        {groupByProperty}
        {selectedProperties}
        selected={selectedPaths.has(filePath)}
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
