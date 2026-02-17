<script lang="ts">
  import { setContext } from "svelte";
  import type { BasesEntry, BasesPropertyId, BasesEntryGroup, App } from "obsidian";
  import type { Readable } from "svelte/store";
  import KanbanBoard from "./KanbanBoard.svelte";
  import KanbanBackground from "./KanbanBackground.svelte";
  import { KANBAN_CONTEXT_KEY } from "../kanban-view/context";
  import type { KanbanContext } from "../kanban-view/context";
  import type { BasesKanbanSettings } from "../settings";

  interface Props {
    app: App;
    rootEl: HTMLElement;
    selectedPathsStore: Readable<Set<string>>;
    initialBoardScrollLeft: number;
    initialBoardScrollTop: number;
    settings: BasesKanbanSettings;
    backgroundImage: unknown;
    backgroundBrightness: number;
    backgroundBlur: number;
    columnTransparency: number;
    columnBlur: number;
    // Store-based reactive data
    groupsStore: Readable<Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>>;
    groupByPropertyStore: Readable<BasesPropertyId | null>;
    selectedPropertiesStore: Readable<BasesPropertyId[]>;
    columnScrollByKeyStore: Readable<Record<string, number>>;
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
    app,
    rootEl,
    selectedPathsStore,
    initialBoardScrollLeft,
    initialBoardScrollTop,
    settings,
    backgroundImage,
    backgroundBrightness,
    backgroundBlur,
    columnTransparency,
    columnBlur,
    groupsStore,
    groupByPropertyStore,
    selectedPropertiesStore,
    columnScrollByKeyStore,
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

  // Provide context to entire component tree
  const contextValue: KanbanContext = {
    app,
    settings,
    selectedPathsStore,
  } as KanbanContext;
  setContext(KANBAN_CONTEXT_KEY, contextValue);

  const backgroundConfig = $derived({
    imageInput: backgroundImage,
    brightness: backgroundBrightness,
    blur: backgroundBlur,
    columnTransparency,
    columnBlur,
  });

  // Derive values from stores - accessing stores with $ prefix makes them reactive
  const groups = $derived($groupsStore);
  const groupByProperty = $derived($groupByPropertyStore);
  const selectedProperties = $derived($selectedPropertiesStore);
  const columnScrollByKey = $derived($columnScrollByKeyStore);

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
  {initialBoardScrollLeft}
  {initialBoardScrollTop}
  {columnScrollByKey}
  {onCreateCard}
  {onCardSelect}
  {onCardDragStart}
  {onCardDragEnd}
  {onCardDrop}
  {onCardContextMenu}
  {onCardLinkClick}
  {onCardsScroll}
  {onBoardScroll}
  {onBoardKeyDown}
  {onBoardClick}
  {onStartColumnDrag}
  {onEndColumnDrag}
  {onColumnDrop}
/>
