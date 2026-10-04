<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";
  import Menu from "$lib/components/Menu.svelte";
  import CoverPreview from "$lib/components/CoverPreview.svelte";
  import { keepFocusOnPress } from "$lib/components/restoreFocus";
  import { contextMenuZone } from "$lib/contextmenu/policy";
  import { chordAria, chordLabel, platformOf } from "$lib/chrome/keys";
  import {
    chapterActions,
    chapterKey,
    projectActions,
    projectKey,
    runChapterAction,
    runProjectAction,
  } from "$lib/binder/itemActions.svelte";

  let {
    onRequestNewChapter,
    onHide,
    inert = false,
    onNavigate,
  }: {
    onRequestNewChapter: () => void;
    /** Fold the panel away (its Hide button). */
    onHide: () => void;
    /** Folded: out of the tab order and the accessibility tree at once. */
    inert?: boolean;
    /** A project or chapter was opened from here; a peek closes on it. */
    onNavigate?: () => void;
  } = $props();

  const platform = platformOf();
  const hideName = $derived(t("chrome.hideBinder"));

  // One handle per row, so a right-click or Shift+F10 on the row opens that
  // row's own ⋯ menu rather than a second copy of it. Only ever called, never
  // rendered from, which is why it is not state.
  const menus: Record<string, ReturnType<typeof Menu> | null> = {};

  /** The row whose menu is open, outlined so "Delete chapter" cannot be read as the open chapter. */
  let menuFor = $state<string | null>(null);

  function trackMenu(key: string, open: boolean): void {
    if (open) menuFor = key;
    else if (menuFor === key) menuFor = null;
  }

  // Nothing opens over a row that store.loading has disabled. The ⋯ itself
  // stays available, as it always has; only right-click and the keys wait.
  const zone = (key: string) =>
    contextMenuZone({ open: (at) => void menus[key]?.openAt(at), enabled: () => !store.loading });
</script>

<aside
  id="binder"
  class="flex h-full min-h-0 flex-col border-r"
  style="border-color: var(--border); background: var(--bg-panel); width: 240px;"
  {inert}
>
  <div class="v-row flex-shrink-0 px-3 pt-3">
    <span class="v-section-title">{t("binder.projects")}</span>
    <!-- Mirrors the + on the Chapters row. The visible word is in the name
         (WCAG 2.5.3); no aria-expanded, which would say "expanded" on a button
         that is gone the moment it works. The rail carries that instead. A
         press leaves focus where it was, so hiding while writing keeps the
         caret. -->
    <button
      class="v-btn v-btn-small"
      style="margin-left: auto;"
      aria-label={hideName}
      aria-controls="binder"
      aria-keyshortcuts={chordAria("toggleBinder", platform)}
      title={t("chrome.withKeys", { label: hideName, keys: chordLabel("toggleBinder", platform) })}
      onmousedown={keepFocusOnPress}
      onclick={onHide}
    >
      {t("chrome.hide")}
    </button>
  </div>
  <ul
    class="m-0 min-h-0 flex-1 list-none overflow-y-auto px-2 py-2"
    aria-label={t("binder.projects")}
    data-item-surface="list"
  >
    {#each store.projects as p (p.path)}
      {@const key = projectKey(p.path)}
      <li>
      <div class="v-row" style="gap: 2px;" {@attach zone(key)}>
      <button
        class="v-list-item {store.project?.path === p.path ? 'v-list-item-active' : ''} {menuFor === key
          ? 'v-menu-target'
          : ''}"
        style="flex: 1; min-width: 0;"
        data-item-key={key}
        aria-current={store.project?.path === p.path ? "true" : undefined}
        disabled={store.loading}
        onclick={() => store.openProject(p.path).then(() => onNavigate?.())}
      >
        <!-- The cover, small. A list of titles is a filing cabinet; seeing the
             book you are making is the thing that gets somebody back to it. -->
        <CoverPreview
          title={p.meta.title}
          author={p.meta.author}
          width={26}
          compact
          dimmed={!p.meta.exportCover}
        />
        <span style="font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis;">
          {p.meta.title}
        </span>
        <span class="v-muted" style="margin-left: auto; font-size: 11px; flex-shrink: 0;">
          {t("binder.wordCount", { words: p.chapters.reduce((a, c) => a + c.words, 0) })}
        </span>
      </button>
      <!-- svelte-ignore binding_property_non_reactive -->
      <Menu
        bind:this={menus[key]}
        label={t("binder.menu.forProject", { title: p.meta.title })}
        items={projectActions()}
        onChoose={(action) => runProjectAction(p, action)}
        onOpenChange={(open) => trackMenu(key, open)}
      />
      </div>
      </li>
    {:else}
      <li class="v-muted px-2" style="font-size: 12px;">{t("binder.noProjects")}</li>
    {/each}
  </ul>

  {#if store.project}
    <div class="v-row flex-shrink-0 border-t px-3 pt-3" style="border-color: var(--border);">
      <span class="v-section-title">{t("binder.chapters")}</span>
      <!-- data-item-fallback: where focus lands when the last chapter is deleted. -->
      <button
        class="v-btn v-btn-small"
        style="margin-left: auto;"
        title={t("binder.newChapter")}
        aria-label={t("binder.newChapter")}
        data-item-fallback
        onclick={onRequestNewChapter}
      >
        +
      </button>
    </div>
    <ul
      class="m-0 min-h-0 flex-1 list-none overflow-y-auto px-2 py-2"
      aria-label={t("binder.chapters")}
      data-item-surface="list"
    >
      {#each store.project.chapters as ch (ch.id)}
        {@const active = store.currentChapter?.id === ch.id}
        {@const key = chapterKey(ch.file)}
        <li>
        <div class="v-row" style="gap: 2px;" {@attach zone(key)}>
        <button
          class="v-list-item {active ? 'v-list-item-active' : ''} {menuFor === key ? 'v-menu-target' : ''}"
          style="flex: 1; min-width: 0;"
          data-item-key={key}
          aria-current={active ? "true" : undefined}
          disabled={store.loading}
          onclick={() => store.openChapter(ch).then(() => onNavigate?.())}
        >
          <!-- Never broken at its hyphen: a long title squeezes itself, not the id. -->
          <span class="v-muted" style="font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0;">
            {ch.id}
          </span>
          <span style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {ch.title}
          </span>
          <span class="v-muted" style="margin-left: auto; font-size: 11px;">
            {t("binder.status." + ch.status)}
          </span>
        </button>
        <!-- svelte-ignore binding_property_non_reactive -->
        <Menu
          bind:this={menus[key]}
          label={t("binder.menu.forChapter", { title: ch.title })}
          items={chapterActions(ch)}
          onChoose={(action) => runChapterAction(ch, action, "list")}
          onOpenChange={(open) => trackMenu(key, open)}
        />
        </div>
        </li>
      {:else}
        <li class="v-muted px-2" style="font-size: 12px;">{t("binder.noChapters")}</li>
      {/each}
    </ul>
  {/if}
</aside>
