<script lang="ts">
  import type { Snippet } from "svelte";
  import { disclosures } from "$lib/settings/disclosures.svelte";

  /**
   * "▸ About this computer", "▸ Where they were found", "▸ Advanced": a
   * button labelled by what it reveals, and the region it reveals. Open state
   * is kept for the session (`key`, `"{page}:{id}"`), so a page left and
   * reopened is as the writer left it.
   */
  let {
    key,
    label,
    initiallyOpen = false,
    trailing,
    children,
  }: {
    key: string;
    label: string;
    /** Open the first time this session, until the writer says otherwise. */
    initiallyOpen?: boolean;
    /** Something beside the button, outside it (a [Check again]). */
    trailing?: Snippet;
    children: Snippet;
  } = $props();

  const id = $props.id();
  let open = $derived(disclosures.isOpen(key, initiallyOpen));
</script>

<div class="v-disclosure-wrap">
  <div class="v-disclosure-head">
    <button
      class="v-disclosure"
      aria-expanded={open}
      aria-controls="{id}-region"
      onclick={() => disclosures.set(key, !open)}
    >
      <span class="v-expander-glyph" aria-hidden="true">{open ? "▾" : "▸"}</span>{label}
    </button>
    {#if trailing}{@render trailing()}{/if}
  </div>
  <div id="{id}-region" class="v-disclosure-region" hidden={!open}>
    {@render children()}
  </div>
</div>
