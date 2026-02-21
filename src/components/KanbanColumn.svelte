<script lang="ts">
  import { getContext } from "svelte";
  import { setIcon, type BasesEntry, type BasesPropertyId } from "obsidian";
  import { onDestroy, onMount } from "svelte";
  import KanbanCard from "./KanbanCard.svelte";
  import { getColumnName } from "../kanban-view/utils";
  import type { createCardDragState, createColumnDragState } from "../kanban-view/drag-state";
  import { KANBAN_CONTEXT_KEY } from "../kanban-view/context";
  import type { KanbanContext } from "../kanban-view/context";

  interface Props {
    columnKey: string;
    groupKey: unknown;
    entries: BasesEntry[];
    startCardIndex: number;
    initialScrollTop: number;
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    columnDragState: ReturnType<typeof createColumnDragState>;
    cardDragState: ReturnType<typeof createCardDragState>;
    isPinned: boolean;
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
      filePath: string | null,
      groupKey: unknown,
      placement: "before" | "after",
    ) => void;
    onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) => void;
    onCardLinkClick: (evt: MouseEvent, target: string) => void;
    onCardsScroll: (scrollTop: number) => void;
    onTogglePin: () => void;
  }

  let {
    columnKey,
    groupKey,
    entries,
    startCardIndex,
    initialScrollTop,
    groupByProperty,
    selectedProperties,
    columnDragState,
    cardDragState,
    isPinned,
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
    onTogglePin,
  }: Props = $props();

  // Get settings from context
  const { settingsStore } = getContext<KanbanContext>(KANBAN_CONTEXT_KEY);
  const settings = $derived($settingsStore);

  let columnEl: HTMLElement | null = $state(null);
  let cardsEl: HTMLElement | null = $state(null);
  // These are imperative cleanup values, not reactive UI state
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let columnRafId: number | null = null;

  const columnName = $derived(getColumnName(groupKey, settings.emptyColumnLabel));

  // Extract stores to local variables so we can use $ prefix
  const columnIsDragging = $derived(columnDragState.isDragging);
  const cardIsDragging = $derived(cardDragState.isDragging);

  // Create reactive stores for this column's drag state
  const isDropTargetBefore = $derived(columnDragState.isDropTargetStore(columnKey));
  const dropPlacement = $derived(columnDragState.getDropPlacementStore(columnKey));
  const isDraggingSourceColumn = $derived(columnDragState.isDraggingSourceStore(columnKey));

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

  // Action to set the pin icon based on pinned state
  function setPinIcon(node: HTMLElement): { destroy: () => void } {
    function updateIcon(): void {
      node.empty();
      setIcon(node, isPinned ? "pin-off" : "pin");
    }

    updateIcon();

    // Return minimal cleanup - Obsidian handles icon lifecycle
    return {
      destroy() {
        // No cleanup needed
      },
    };
  }
</script>

<div
  bind:this={columnEl}
  class="bases-kanban-column"
  class:bases-kanban-column-drop-before={$isDropTargetBefore && $dropPlacement === "before"}
  class:bases-kanban-column-drop-after={$isDropTargetBefore && $dropPlacement === "after"}
  class:bases-kanban-column-dragging={$isDraggingSourceColumn}
  data-column-key={columnKey}
  style:--bases-kanban-column-header-width="{settings.columnHeaderWidth}px"
  ondragover={(evt) => {
    if (!$columnIsDragging) return;
    evt.preventDefault();
    // Throttle via requestAnimationFrame to reduce churn
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
    // Cancel pending RAF
    if (columnRafId !== null) {
      cancelAnimationFrame(columnRafId);
      columnRafId = null;
    }
    const placement = columnDragState.getDropPlacement(columnKey) ?? "before";
    onSetColumnDropTarget(null, null);
    onColumnDrop(columnKey, placement);
  }}
  role="region"
>
  <div
    class="bases-kanban-column-header"
    draggable="true"
    role="button"
    tabindex="0"
    ondragstart={(evt) => {
      // Don't initiate drag if clicking the add button
      const target = evt.target as HTMLElement;
      if (target.closest(".bases-kanban-add-card-button") !== null) {
        evt.preventDefault();
        return;
      }
      onStartColumnDrag(evt, columnKey);
    }}
    ondragend={() => {
      // Cancel pending RAF
      if (columnRafId !== null) {
        cancelAnimationFrame(columnRafId);
        columnRafId = null;
      }
      onEndColumnDrag();
    }}
  >
    <div class="bases-kanban-column-handle">
      <h3 style:width="{settings.columnHeaderWidth}px">{columnName}</h3>
    </div>
    <span class="bases-kanban-column-count">{entries.length}</span>
    <button
      type="button"
      class="bases-kanban-add-card-button"
      draggable="false"
      onmousedown={(evt) => evt.stopPropagation()}
      onclick={(evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        onCreateCard();
      }}
    >
      {settings.addCardButtonText}
    </button>
    <button
      type="button"
      class="bases-kanban-pin-button"
      draggable="false"
      aria-label={isPinned ? "Unpin column" : "Pin column"}
      onmousedown={(evt) => evt.stopPropagation()}
      onclick={(evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        onTogglePin();
      }}
      use:setPinIcon
    >
    </button>
  </div>

  <div
    bind:this={cardsEl}
    class="bases-kanban-cards"
    ondragover={(evt) => {
      if (groupByProperty === null || !$cardIsDragging) return;
      evt.preventDefault();

      // When dragging over the container (not directly on a card), find the
      // closest card to the cursor and set it as the drop target. This handles
      // edge cases where the cursor is near card boundaries or in gaps.
      if (cardsEl === null) return;

      const target = evt.target as HTMLElement;
      const isOnCard = target.closest(".bases-kanban-card") !== null;
      if (isOnCard) {
        // Card's own dragover handler will handle this
        return;
      }

      // Find the card closest to the cursor Y position
      const cards = cardsEl.querySelectorAll(".bases-kanban-card");
      if (cards.length === 0) {
        // Empty column - let the container drop handler handle this
        onSetCardDropTarget(null, null, null);
        return;
      }

      let closestCard: Element | null = null;
      let closestDistance = Infinity;
      let placement: "before" | "after" = "after";

      for (const card of Array.from(cards)) {
        const rect = card.getBoundingClientRect();
        const cardTop = rect.top;
        const cardBottom = rect.bottom;
        const cardMiddle = cardTop + rect.height / 2;
        const mouseY = evt.clientY;

        // Check if mouse is within the card's vertical range (with some tolerance)
        const tolerance = 10; // pixels of tolerance for edge detection
        if (mouseY >= cardTop - tolerance && mouseY <= cardBottom + tolerance) {
          const distance = Math.abs(mouseY - cardMiddle);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestCard = card;
            placement = mouseY < cardMiddle ? "before" : "after";
          }
        }
      }

      if (closestCard !== null) {
        const cardPath = closestCard.getAttribute("data-card-path");
        if (cardPath !== null) {
          onSetCardDropTarget(cardPath, columnKey, placement);
        }
      }
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
      onCardDrop(null, groupKey, placement);
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
