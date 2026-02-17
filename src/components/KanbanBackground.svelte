<script lang="ts">
  import type { App } from "obsidian";
  import { resolveBackgroundStyles, preloadBackgroundImage, type BackgroundConfig } from "../kanban-view/background-manager";

  interface Props {
    app: App;
    rootEl: HTMLElement;
    config: BackgroundConfig;
  }

  let { app, rootEl, config }: Props = $props();

  // Resolve background styles reactively
  const styles = $derived(resolveBackgroundStyles(app, config));

  // Background element reference
  let bgEl: HTMLDivElement | null = $state(null);
  let currentImageCleanup: (() => void) | null = $state(null);

  // Apply background image when URL changes
  $effect(() => {
    if (bgEl === null || !styles.hasImage || styles.imageUrl === null) {
      // Clean up any pending image load
      if (currentImageCleanup !== null) {
        currentImageCleanup();
        currentImageCleanup = null;
      }
      return;
    }

    // Clean up previous image load
    if (currentImageCleanup !== null) {
      currentImageCleanup();
    }

    // Start preloading the new image
    currentImageCleanup = preloadBackgroundImage(
      styles.imageUrl,
      bgEl,
      () => { currentImageCleanup = null; },
      () => { currentImageCleanup = null; }
    );
  });

  // Cleanup on component destroy
  $effect(() => {
    return () => {
      if (currentImageCleanup !== null) {
        currentImageCleanup();
      }
    };
  });
</script>

{#if styles.hasImage}
  <div
    bind:this={bgEl}
    class="bases-kanban-background"
    style:background-image={styles.imageUrl ? `url("${styles.imageUrl}")` : null}
    style:filter={styles.backgroundFilter}
  ></div>
{/if}
