<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A row that opens below itself: Ollama and the local server on Models,
   * each app on Access to your novel.
   *
   * The header is one button, named by the title and the status in the order
   * they read ("Ollama, Running · 1 model"): written out as the name, because
   * the comma a hidden span would add is read as its own word between flex
   * items. Actions such as Connect sit beside it, never inside it: a button
   * inside a button is announced as one control and cannot be reached on its
   * own. One level deep, never nested.
   */
  let {
    id,
    title,
    status,
    tone = "mute",
    open = $bindable(false),
    header = $bindable(),
    focusKey,
    actions,
    children,
  }: {
    /** Unique on the page; the panel is `{id}-panel`. */
    id: string;
    title: string;
    status: string;
    /** The dot's colour, which always comes with `status` in words. */
    tone?: "ok" | "warn" | "mute";
    open?: boolean;
    /** The header button, for focus to be handed to. */
    header?: HTMLButtonElement;
    /** Marks the header as where a link into Settings lands (`data-settings-focus`). */
    focusKey?: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<div class="v-expander" data-open={open || undefined}>
  <div class="v-expander-head">
    <button
      bind:this={header}
      data-settings-focus={focusKey}
      class="v-expander-toggle"
      aria-expanded={open}
      aria-controls="{id}-panel"
      aria-label="{title}, {status}"
      onclick={() => (open = !open)}
    >
      <span class="v-expander-glyph" aria-hidden="true">{open ? "▾" : "▸"}</span>
      <span class="v-expander-title">{title}</span>
      <span class="v-expander-status">
        <span class="v-status-dot" data-tone={tone} aria-hidden="true"></span>{status}
      </span>
    </button>
    {#if actions}
      <div class="v-expander-actions">{@render actions()}</div>
    {/if}
  </div>
  <div id="{id}-panel" class="v-expander-panel" hidden={!open}>
    {@render children()}
  </div>
</div>
