<script lang="ts">
    import type { App } from "obsidian";
    import {
        resolveBackgroundStyles,
        type BackgroundConfig,
    } from "../kanban-view/background-manager";

    interface Props {
        app: App;
        config: BackgroundConfig;
    }

    let { app, config }: Props = $props();

    const styles = $derived(resolveBackgroundStyles(app, config));
</script>

<div
    class="bases-kanban-background"
    style:filter={styles.backgroundFilter}
    style:display={styles.hasImage ? "block" : "none"}
></div>
