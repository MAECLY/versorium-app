<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";
  import { isTauri } from "$lib/tauri";

  let { onRequestNew, onRequestSetup }: {
    onRequestNew: () => void;
    onRequestSetup?: () => void;
  } = $props();
</script>

<div
  class="flex h-full flex-col items-center justify-center gap-4"
  style="background: var(--bg-editor);"
>
  <svg width="72" height="72" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="none" stroke="var(--accent)" stroke-width="4" />
    <path d="M50 10 L62 50 L50 90 L38 50 Z" fill="var(--accent)" transform="rotate(45 50 50)" />
    <circle cx="50" cy="50" r="6" fill="var(--bg-editor)" />
  </svg>
  <h1 class="m-0" style="font-size: 22px; font-weight: 600;">{t("empty.title")}</h1>
  <p class="v-muted m-0 max-w-sm text-center" style="font-size: 14px; line-height: 1.6;">
    {t("empty.body")}
  </p>
  {#if isTauri()}
    <button class="v-btn v-btn-primary" onclick={onRequestNew}>{t("empty.cta")}</button>
    {#if onRequestSetup}
      <!-- A quiet way back for anyone who skipped the first run. -->
      <button
        class="v-btn"
        style="background: transparent; border-color: transparent; font-size: 12px;"
        onclick={onRequestSetup}
      >
        {t("empty.setup")}
      </button>
    {/if}
  {/if}
</div>
