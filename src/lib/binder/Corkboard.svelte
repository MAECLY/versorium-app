<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { api, isTauri, type ChapterMeta } from "$lib/tauri";
  import { t } from "$lib/i18n";
  import ItemMenu from "$lib/binder/ItemMenu.svelte";
  import { contextMenuZone } from "$lib/contextmenu/policy";
  import { chapterActions, chapterKey, runChapterAction } from "$lib/binder/itemActions.svelte";

  const PREVIEW_CHARS = 200;

  // Bodies are not in the chapter metadata, so the board reads them itself.
  // Cached per file: flipping between views should not re-read the manuscript,
  // and the editor must never wait on this.
  let previews = $state<Record<string, string>>({});
  let loading = $state(false);
  // Deliberately not reactive: the effect below must not depend on what it
  // writes, or storing a preview re-triggers the read that stored it.
  const requested = new Set<string>();

  /** Strip the markers so a card reads as prose rather than as source. */
  function synopsis(body: string): string {
    const text = body
      .split("\n")
      .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
      .filter(Boolean)
      .join(" ");
    return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;
  }

  async function loadPreviews(path: string, chapters: ChapterMeta[]): Promise<void> {
    if (!isTauri()) return;
    const missing = chapters.filter((c) => !requested.has(c.file));
    if (missing.length === 0) return;
    for (const chapter of missing) requested.add(chapter.file);
    loading = true;
    try {
      for (const chapter of missing) {
        try {
          const doc = await api.readChapter(path, chapter.file);
          previews = { ...previews, [chapter.file]: synopsis(doc.body) };
        } catch {
          // One unreadable chapter must not blank the whole board.
          previews = { ...previews, [chapter.file]: "" };
        }
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const path = store.project?.path;
    const chapters = store.project?.chapters;
    if (!path || !chapters) return;
    void loadPreviews(path, chapters);
  });

  // The card's menu is the chapter's binder menu, opened where the writer's
  // pointer already is: index-card apps put card actions on right-click. Only
  // ever called, never rendered from, which is why it is not state.
  const menus: Record<string, ReturnType<typeof ItemMenu> | null> = {};
  let menuFor = $state<string | null>(null);

  function trackMenu(key: string, open: boolean): void {
    if (open) menuFor = key;
    else if (menuFor === key) menuFor = null;
  }

  // Nothing opens over a card that store.loading has disabled.
  const zone = (key: string) =>
    contextMenuZone({ open: (at) => void menus[key]?.openAt(at), enabled: () => !store.loading });
</script>

<div class="h-full min-h-0 overflow-y-auto" style="padding: 24px;">
  <div class="v-row mb-3">
    <span class="v-section-title">{t("binder.corkboard")}</span>
    {#if loading}
      <span class="v-muted" style="margin-left: auto; font-size: 12px;" aria-live="polite">
        {t("binder.corkboardLoading")}
      </span>
    {/if}
  </div>

  {#if store.project && store.project.chapters.length > 0}
    <ul
      class="m-0 list-none p-0"
      aria-label={t("binder.corkboard")}
      style="display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));"
      data-item-surface="board"
    >
      {#each store.project.chapters as chapter (chapter.id)}
        {@const active = store.currentChapter?.id === chapter.id}
        {@const key = chapterKey(chapter.file)}
        <li {@attach zone(key)}>
          <button
            class="v-card v-corkcard {active ? 'v-corkcard-active' : ''} {menuFor === key ? 'v-menu-target' : ''}"
            data-item-key={key}
            aria-current={active ? "true" : undefined}
            disabled={store.loading}
            onclick={() => store.openChapter(chapter)}
          >
            <span class="v-row" style="gap: 8px;">
              <span class="v-muted" style="font-size: 11px; font-variant-numeric: tabular-nums;">
                {chapter.id}
              </span>
              <span class="v-muted" style="margin-left: auto; font-size: 11px;">
                {t("binder.status." + chapter.status)}
              </span>
            </span>
            <span style="font-size: 14px; font-weight: 600; margin-top: 6px;">{chapter.title}</span>
            <span class="v-muted" style="font-size: 12px; line-height: 1.5; margin-top: 6px; flex: 1;">
              {previews[chapter.file] || t("binder.corkboardEmpty")}
            </span>
            <span class="v-muted" style="font-size: 11px; margin-top: 10px;">
              {t("binder.wordCount", { words: chapter.words })}
            </span>
          </button>
          <!-- A sibling of the card, never inside it, so choosing an item can
               never also click the card open. No ⋯ ("almost no icons"): the
               binder's ⋯ for the same chapter is the visible route. -->
          <!-- svelte-ignore binding_property_non_reactive -->
          <ItemMenu
            bind:this={menus[key]}
            trigger={false}
            label={t("binder.menu.forChapter", { title: chapter.title })}
            actions={chapterActions(chapter)}
            onChoose={(id) => runChapterAction(chapter, id, "board")}
            onOpenChange={(open) => trackMenu(key, open)}
          />
        </li>
      {/each}
    </ul>
  {:else}
    <p class="v-muted m-0" style="font-size: 13px;">{t("binder.noChapters")}</p>
  {/if}
</div>
