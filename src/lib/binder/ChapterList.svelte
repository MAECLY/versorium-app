<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";

  let { onRequestNewChapter }: { onRequestNewChapter: () => void } = $props();
</script>

<aside
  class="flex h-full min-h-0 flex-col border-r"
  style="border-color: var(--border); background: var(--bg-panel); width: 240px;"
>
  <div class="v-row flex-shrink-0 px-3 pt-3">
    <span class="v-section-title">{t("binder.projects")}</span>
  </div>
  <ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto px-2 py-2" aria-label={t("binder.projects")}>
    {#each store.projects as p (p.path)}
      <li>
      <button
        class="v-list-item {store.project?.path === p.path ? 'v-list-item-active' : ''}"
        aria-current={store.project?.path === p.path ? "true" : undefined}
        disabled={store.loading}
        onclick={() => store.openProject(p.path)}
      >
        <span style="font-size: 13px;">{p.meta.title}</span>
        <span class="v-muted" style="margin-left: auto; font-size: 11px;">
          {t("binder.wordCount", { words: p.chapters.reduce((a, c) => a + c.words, 0) })}
        </span>
      </button>
      </li>
    {:else}
      <li class="v-muted px-2" style="font-size: 12px;">{t("binder.noProjects")}</li>
    {/each}
  </ul>

  {#if store.project}
    <div class="v-row flex-shrink-0 border-t px-3 pt-3" style="border-color: var(--border);">
      <span class="v-section-title">{t("binder.chapters")}</span>
      <button
        class="v-btn"
        style="margin-left: auto; padding: 2px 8px; font-size: 12px;"
        title={t("binder.newChapter")}
        aria-label={t("binder.newChapter")}
        onclick={onRequestNewChapter}
      >
        +
      </button>
    </div>
    <ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto px-2 py-2" aria-label={t("binder.chapters")}>
      {#each store.project.chapters as ch (ch.id)}
        {@const active = store.currentChapter?.id === ch.id}
        <li>
        <button
          class="v-list-item {active ? 'v-list-item-active' : ''}"
          aria-current={active ? "true" : undefined}
          disabled={store.loading}
          onclick={() => store.openChapter(ch)}
        >
          <span class="v-muted" style="font-size: 11px; font-variant-numeric: tabular-nums;">
            {ch.id}
          </span>
          <span style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {ch.title}
          </span>
          <span class="v-muted" style="margin-left: auto; font-size: 11px;">
            {t("binder.status." + ch.status)}
          </span>
        </button>
        </li>
      {:else}
        <li class="v-muted px-2" style="font-size: 12px;">{t("binder.noChapters")}</li>
      {/each}
    </ul>
  {/if}
</aside>
