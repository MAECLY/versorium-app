<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { api, isTauri, type ChapterMeta } from "$lib/tauri";
  import { t } from "$lib/i18n";
  import Menu from "$lib/components/Menu.svelte";
  import { contextMenuZone } from "$lib/contextmenu/policy";
  import { chapterActions, chapterKey, runChapterAction } from "$lib/binder/itemActions.svelte";
  import { cardText, type CardText } from "$lib/binder/cardText";

  // Neither a synopsis nor a body is in the chapter metadata, so the board
  // reads each chapter itself. Cached per file: flipping between views should
  // not re-read the manuscript, and the editor must never wait on this.
  let cards = $state<Record<string, CardText>>({});
  /** A card not read yet, or one that could not be read. */
  const NOTHING: CardText = { kind: "empty", text: "" };
  /** What a screen reader hears before the card's words. */
  const CARD_LABEL = { synopsis: "binder.corkboardSynopsis", opening: "binder.corkboardOpening" } as const;
  let loading = $state(false);
  // Deliberately not reactive: the effect below must not depend on what it
  // writes, or storing a card re-triggers the read that stored it.
  const requested = new Set<string>();

  async function loadCards(path: string, chapters: ChapterMeta[]): Promise<void> {
    if (!isTauri()) return;
    const missing = chapters.filter((c) => !requested.has(c.file));
    if (missing.length === 0) return;
    for (const chapter of missing) requested.add(chapter.file);
    loading = true;
    try {
      for (const chapter of missing) {
        try {
          const doc = await api.readChapter(path, chapter.file);
          cards = { ...cards, [chapter.file]: cardText(doc) };
        } catch {
          // One unreadable chapter must not blank the whole board.
          cards = { ...cards, [chapter.file]: NOTHING };
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
    void loadCards(path, chapters);
  });

  // The card's menu is the chapter's binder menu, opened where the writer's
  // pointer already is: index-card apps put card actions on right-click. Only
  // ever called, never rendered from, which is why it is not state.
  const menus: Record<string, ReturnType<typeof Menu> | null> = {};
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
        {@const card = cards[chapter.file] ?? NOTHING}
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
            <!-- The writer's synopsis reads as their own words; an excerpt is
                 set apart as a quotation, and a screen reader hears which. -->
            <span class="v-corkcard-text" data-card-text={card.kind}>
              {#if card.kind === "empty"}
                {t("binder.corkboardEmpty")}
              {:else}
                <span class="sr-only">{t(CARD_LABEL[card.kind])}</span> {card.text}
              {/if}
            </span>
            <span class="v-muted" style="font-size: 11px; margin-top: 10px;">
              {t("binder.wordCount", { words: chapter.words })}
            </span>
          </button>
          <!-- A sibling of the card, never inside it, so choosing an item can
               never also click the card open. No ⋯ ("almost no icons"): the
               binder's ⋯ for the same chapter is the visible route. -->
          <!-- svelte-ignore binding_property_non_reactive -->
          <Menu
            bind:this={menus[key]}
            trigger={false}
            label={t("binder.menu.forChapter", { title: chapter.title })}
            items={chapterActions(chapter)}
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
