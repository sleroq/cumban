<script lang="ts">
  import type { BasesEntry, BasesPropertyId, BasesEntryGroup, App } from "obsidian";
  import KanbanBoard from "./KanbanBoard.svelte";
  import KanbanBackground from "./KanbanBackground.svelte";

  interface Props {
    app: App;
    rootEl: HTMLElement;
    groups: Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>;
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
    backgroundImage: unknown;
    backgroundBrightness: number;
    backgroundBlur: number;
    columnTransparency: number;
    columnBlur: number;
    onCreateCard: (groupByProperty: BasesPropertyId | null, groupKey: unknown) => void;
    onCardSelect: (filePath: string, extendSelection: boolean) => void;
    onCardDragStart: (evt: DragEvent, filePath: string, cardIndex: number) => void;
    onCardDragEnd: () => void;
    onSetCardDropTarget: (targetPath: string | null, placement: "before" | "after" | null) => void;
    onCardDrop: (evt: DragEvent, filePath: string | null, groupKey: unknown) => void;
    onCardContextMenu: (evt: MouseEvent, entry: BasesEntry) => void;
    onCardLinkClick: (evt: MouseEvent, target: string) => void;
    onCardsScroll: (columnKey: string, scrollTop: number) => void;
    onBoardScroll: (scrollLeft: number, scrollTop: number) => void;
    onBoardKeyDown: (evt: KeyboardEvent) => void;
    onBoardClick: (evt: MouseEvent) => void;
    onStartColumnDrag: (evt: DragEvent, columnKey: string) => void;
    onEndColumnDrag: () => void;
    onSetColumnDropTarget: (targetKey: string | null, placement: "before" | "after" | null) => void;
    onColumnDrop: (targetKey: string, placement: "before" | "after") => void;
  }

  let {
    app,
    rootEl,
    groups,
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
    backgroundImage,
    backgroundBrightness,
    backgroundBlur,
    columnTransparency,
    columnBlur,
    onCreateCard,
    onCardSelect,
    onCardDragStart,
    onCardDragEnd,
    onSetCardDropTarget,
    onCardDrop,
    onCardContextMenu,
    onCardLinkClick,
    onCardsScroll,
    onBoardScroll,
    onBoardKeyDown,
    onBoardClick,
    onStartColumnDrag,
    onEndColumnDrag,
    onSetColumnDropTarget,
    onColumnDrop,
  }: Props = $props();

  const backgroundConfig = $derived({
    imageInput: backgroundImage,
    brightness: backgroundBrightness,
    blur: backgroundBlur,
    columnTransparency,
    columnBlur,
  });
</script>

<KanbanBackground
  {app}
  {rootEl}
  config={backgroundConfig}
/>

<KanbanBoard
  {groups}
  {groupByProperty}
  {selectedProperties}
  {selectedPaths}
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
  {onCreateCard}
  {onCardSelect}
  {onCardDragStart}
  {onCardDragEnd}
  {onSetCardDropTarget}
  {onCardDrop}
  {onCardContextMenu}
  {onCardLinkClick}
  {onCardsScroll}
  {onBoardScroll}
  {onBoardKeyDown}
  {onBoardClick}
  {onStartColumnDrag}
  {onEndColumnDrag}
  {onSetColumnDropTarget}
  {onColumnDrop}
/>
