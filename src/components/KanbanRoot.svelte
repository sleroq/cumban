<script lang="ts">
    import { setContext } from "svelte";
    import { writable } from "svelte/store";
    import type {
        BasesEntry,
        BasesPropertyId,
        BasesEntryGroup,
        App,
    } from "obsidian";
    import type { Readable } from "svelte/store";
    import KanbanBoard from "./KanbanBoard.svelte";
    import KanbanBackground from "./KanbanBackground.svelte";
    import { KANBAN_CONTEXT_KEY } from "../kanban-view/context";
    import type { KanbanContext } from "../kanban-view/context";
    import type { KanbanCallbacks } from "../kanban-view/actions";
    import { DEFAULT_SETTINGS, type BasesKanbanSettings } from "../settings";

    type Props = {
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
        groupsStore: Readable<
            Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>
        >;
        groupByPropertyStore: Readable<BasesPropertyId | null>;
        selectedPropertiesStore: Readable<BasesPropertyId[]>;
        columnScrollByKeyStore: Readable<Record<string, number>>;
        pinnedColumnsStore: Readable<Set<string>>;
        callbacks: KanbanCallbacks;
    };

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
        pinnedColumnsStore,
        callbacks,
    }: Props = $props();

    const settingsStore = writable(DEFAULT_SETTINGS);
    $effect(() => {
        settingsStore.set(settings);
    });

    const contextValue: KanbanContext = $state({
        get app() {
            return app;
        },
        get settingsStore() {
            return settingsStore;
        },
        get selectedPathsStore() {
            return selectedPathsStore;
        },
        get pinnedColumnsStore() {
            return pinnedColumnsStore;
        },
    }) as KanbanContext;
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
    const pinnedColumns = $derived($pinnedColumnsStore);
</script>

<KanbanBackground {app} {rootEl} config={backgroundConfig} />

<KanbanBoard
    {groups}
    {groupByProperty}
    {selectedProperties}
    {initialBoardScrollLeft}
    {initialBoardScrollTop}
    {columnScrollByKey}
    {pinnedColumns}
    {callbacks}
/>
