<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";
  import { getTheme, getThemeMode } from "$lib/themes";

  let words = $derived(
    store.chapterBody
      ? store.chapterBody.split(/\s+/).filter(Boolean).length
      : 0,
  );
</script>

<footer
  class="v-row flex-shrink-0 border-t px-4"
  style="border-color: var(--border); height: 28px; font-size: 12px; color: var(--text-mute); gap: 16px;"
>
  {#if store.currentChapter}
    <span>{t("statusbar.words", { words })}</span>
    <span class="v-muted">{store.currentChapter.id} · {store.currentChapter.title}</span>
    <span style="color: {store.saveState === 'error' ? 'var(--warn)' : 'var(--ok)'}">
      {store.saveState === "saving"
        ? t("editor.saving")
        : store.saveState === "error"
          ? t("editor.unsaved")
          : t("editor.saved")}
    </span>
  {:else}
    <span>{t("empty.title")}</span>
  {/if}

  <span style="margin-left: auto;">
    {getTheme()} · {getThemeMode()}
  </span>
</footer>
