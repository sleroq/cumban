<script lang="ts">
  import type { BasesEntry, BasesPropertyId } from "obsidian";
  import {
    getPropertyValues,
    parseWikiLinks,
    getHashColor,
  } from "../kanban-view/utils";
  import type { createCardDragState } from "../kanban-view/drag-state";

  interface Props {
    entry: BasesEntry;
    groupKey: unknown;
    cardIndex: number;
    groupByProperty: BasesPropertyId | null;
    selectedProperties: BasesPropertyId[];
    selected: boolean;
    cardTitleSource: "basename" | "filename" | "path";
    cardTitleMaxLength: number;
    propertyValueSeparator: string;
    tagPropertySuffix: string;
    tagSaturation: number;
    tagLightness: number;
    tagAlpha: number;
    cardDragState: ReturnType<typeof createCardDragState>;
    onSelect: (filePath: string, extendSelection: boolean) => void;
    onDragStart: (evt: DragEvent, filePath: string, cardIndex: number) => void;
    onDragEnd: () => void;
    onSetDropTarget: (targetPath: string | null, placement: "before" | "after" | null) => void;
    onDrop: (evt: DragEvent, filePath: string | null, groupKey: unknown) => void;
    onContextMenu: (evt: MouseEvent) => void;
    onLinkClick: (evt: MouseEvent, target: string) => void;
  }

  let {
    entry,
    groupKey,
    cardIndex,
    groupByProperty,
    selectedProperties,
    selected,
    cardTitleSource,
    cardTitleMaxLength,
    propertyValueSeparator,
    tagPropertySuffix,
    tagSaturation,
    tagLightness,
    tagAlpha,
    cardDragState,
    onSelect,
    onDragStart,
    onDragEnd,
    onSetDropTarget,
    onDrop,
    onContextMenu,
    onLinkClick,
  }: Props = $props();

  let cardEl: HTMLElement | null = $state(null);
  let isDraggable: boolean = $state(false);

  const filePath = entry.file.path;
  const fullTitle = getCardTitle(entry, cardTitleSource);
  const title = truncateTitle(fullTitle, cardTitleMaxLength);

  const propertiesToDisplay = selectedProperties.filter(
    (propertyId) =>
      propertyId !== "file.name" && propertyId !== groupByProperty,
  );

  // Extract stores to local variables
  const cardTargetPath = cardDragState.targetPath;
  const cardPlacement = cardDragState.placement;

  // Reactive state using methods
  const isDraggingSource = $derived(cardDragState.isDraggingSource(filePath));
  const isDropTarget = $derived(cardDragState.isDropTarget(filePath));
  const dropPlacement = $derived(cardDragState.getDropPlacement(filePath));

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

  function handleClick(evt: MouseEvent): void {
    if ((evt.target as HTMLElement).closest("a") !== null) {
      return;
    }
    onSelect(filePath, evt.shiftKey || evt.metaKey);
  }

  function handleMouseDown(evt: MouseEvent): void {
    if (groupByProperty !== null) {
      isDraggable = evt.button === 0;
    }
  }

  function handleMouseUp(): void {
    if (!isDraggingSource) {
      isDraggable = false;
    }
  }

  function handleDragStart(evt: DragEvent): void {
    onDragStart(evt, filePath, cardIndex);
  }

  function handleDragOver(evt: DragEvent): void {
    if (groupByProperty === null) return;
    evt.preventDefault();
    evt.stopPropagation();

    // Calculate drop placement based on mouse position
    if (cardEl !== null) {
      const rect = cardEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const placement = evt.clientY < midY ? "before" : "after";
      onSetDropTarget(filePath, placement);
    }
  }

  function handleDragLeave(evt: DragEvent): void {
    const relatedTarget = evt.relatedTarget as Node | null;
    if (cardEl !== null && relatedTarget !== null && cardEl.contains(relatedTarget)) {
      return;
    }
    onSetDropTarget(null, null);
  }

  function handleDrop(evt: DragEvent): void {
    if (groupByProperty === null) return;
    evt.preventDefault();
    evt.stopPropagation();
    onDrop(evt, filePath, groupKey);
  }

  function handleContextMenu(evt: MouseEvent): void {
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    onContextMenu(evt);
  }

  function handleLinkClick(evt: MouseEvent): void {
    evt.preventDefault();
    evt.stopPropagation();
    onLinkClick(evt, filePath);
  }

  function handleTitleContextMenu(evt: MouseEvent): void {
    onContextMenu(evt);
  }

  function handlePropertyLinkClick(evt: MouseEvent, target: string): void {
    evt.preventDefault();
    evt.stopPropagation();
    onLinkClick(evt, target);
  }
</script>

<div
  bind:this={cardEl}
  class="bases-kanban-card"
  class:bases-kanban-card-selected={selected}
  class:bases-kanban-card-dragging={isDraggingSource}
  class:bases-kanban-card-drop-before={isDropTarget && dropPlacement === "before"}
  class:bases-kanban-card-drop-after={isDropTarget && dropPlacement === "after"}
  draggable={isDraggable}
  data-card-path={filePath}
  onclick={handleClick}
  onmousedown={handleMouseDown}
  onmouseup={handleMouseUp}
  ondragstart={handleDragStart}
  ondragend={onDragEnd}
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
          <div class="bases-kanban-property-row">
            {#each values as value, i (i)}
              {@const links = parseWikiLinks(value)}
              {@const isTagProperty = propertyId.endsWith(tagPropertySuffix)}
              {#if links.length === 0}
                {@const cls = isTagProperty
                  ? "bases-kanban-property-value bases-kanban-property-tag"
                  : "bases-kanban-property-value"}
                <span
                  class={cls}
                  style:background-color={isTagProperty
                    ? getHashColor(value, tagSaturation, tagLightness, tagAlpha)
                    : undefined}
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
                    style:background-color={isTagProperty
                      ? getHashColor(link.display, tagSaturation, tagLightness, tagAlpha)
                      : undefined}
                    onclick={(evt: MouseEvent) => handlePropertyLinkClick(evt, link.target)}
                  >
                    {link.display}
                  </a>
                  {#if !isTagProperty && linkIndex < links.length - 1}
                    <span class="bases-kanban-property-separator"
                      >{propertyValueSeparator}</span
                    >
                  {/if}
                {/each}
              {/if}
              {#if !isTagProperty && i < values.length - 1}
                <span class="bases-kanban-property-separator"
                  >{propertyValueSeparator}</span
                >
              {/if}
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
