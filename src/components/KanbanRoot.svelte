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
        selectedPathsStore: Readable<Set<string>>;
        initialBoardScrollLeft: number;
        initialBoardScrollTop: number;
        settings: BasesKanbanSettings;
        backgroundImage: unknown;
        backgroundBrightness: number;
        backgroundBlur: number;
        columnTransparency: number;
        columnBlur: number;
        columnsRightToLeft: boolean;
        groupsStore: Readable<
            Array<{ group: BasesEntryGroup; entries: BasesEntry[] }>
        >;
        groupByPropertyStore: Readable<BasesPropertyId | null>;
        selectedPropertiesStore: Readable<BasesPropertyId[]>;
        columnScrollByKeyStore: Readable<Record<string, number>>;
        pinnedColumnsStore: Readable<Set<string>>;
        animationsReadyStore: Readable<boolean>;
        callbacks: KanbanCallbacks;
    };

    let {
        app,
        selectedPathsStore,
        initialBoardScrollLeft,
        initialBoardScrollTop,
        settings,
        backgroundImage,
        backgroundBrightness,
        backgroundBlur,
        columnTransparency,
        columnBlur,
        columnsRightToLeft,
        groupsStore,
        groupByPropertyStore,
        selectedPropertiesStore,
        columnScrollByKeyStore,
        pinnedColumnsStore,
        animationsReadyStore,
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
        get animationsReadyStore() {
            return animationsReadyStore;
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

    const groups = $derived($groupsStore);
    const groupByProperty = $derived($groupByPropertyStore);
    const selectedProperties = $derived($selectedPropertiesStore);
    const columnScrollByKey = $derived($columnScrollByKeyStore);
    const pinnedColumns = $derived($pinnedColumnsStore);
</script>

<KanbanBackground {app} config={backgroundConfig} />

<KanbanBoard
    {groups}
    {groupByProperty}
    {selectedProperties}
    {initialBoardScrollLeft}
    {initialBoardScrollTop}
    {columnScrollByKey}
    {pinnedColumns}
    {columnsRightToLeft}
    {callbacks}
/>
