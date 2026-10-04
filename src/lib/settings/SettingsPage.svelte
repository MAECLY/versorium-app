<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { t } from "$lib/i18n";
  import { isTauri } from "$lib/tauri";
  import { models } from "$lib/models/state.svelte";
  import { mcp } from "$lib/mcp/state.svelte";
  import { restoreFocus } from "$lib/components/restoreFocus";
  import { CATEGORIES, FOOTER, focusKey, type PageId, type SettingsTarget } from "$lib/settings/pages";
  import { provideSettingsNav } from "$lib/settings/nav";
  import AppearanceGroup from "$lib/settings/groups/AppearanceGroup.svelte";
  import AppGroup from "$lib/settings/groups/AppGroup.svelte";
  import AssistantsGroup from "$lib/settings/groups/AssistantsGroup.svelte";
  import AccessGroup from "$lib/settings/groups/AccessGroup.svelte";
  import ActivityGroup from "$lib/settings/groups/ActivityGroup.svelte";
  import AuthorGroup from "$lib/settings/groups/AuthorGroup.svelte";
  import BackupGroup from "$lib/settings/groups/BackupGroup.svelte";
  import EditorGroup from "$lib/settings/groups/EditorGroup.svelte";
  import TasksGroup from "$lib/settings/groups/TasksGroup.svelte";
  import ModelsGroup from "$lib/settings/groups/ModelsGroup.svelte";

  let {
    onClose,
    initial = null,
    request = 0,
    onOpenManuscript,
  }: {
    onClose: () => void;
    /** A place a link asked for; null opens on Editor. */
    initial?: SettingsTarget | null;
    /** Bumped by App per request, so asking again while open still goes there. */
    request?: number;
    onOpenManuscript?: (tab: "continuity") => void;
  } = $props();

  let target = $state<SettingsTarget>(untrack(() => initial) ?? { page: "editor" });
  let active = $derived<PageId>(target.page);

  let rail: HTMLElement;
  let pane: HTMLDivElement;
  let title: HTMLHeadingElement;
  /** Bumped per navigation, so a slow landing gives way to a newer one. */
  let landing = 0;

  /**
   * Go to a page. Focus follows: to the control the target names once it is
   * there and enabled (a page may still be loading what it shows), otherwise
   * to the page's title, which says where the writer is now.
   */
  async function navigate(next: SettingsTarget): Promise<void> {
    target = next;
    pane?.scrollTo?.({ top: 0 });
    const seq = ++landing;
    await tick();
    const key = focusKey(next);
    if (key) {
      const deadline = Date.now() + 4000;
      while (seq === landing && Date.now() < deadline) {
        if (restoreFocus(focusable(key))) return;
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
      if (seq !== landing) return;
    }
    restoreFocus(title);
  }

  /** The element a page marked for `key`, or the first control inside it, once enabled. */
  function focusable(key: string): HTMLElement | null {
    const host = pane?.querySelector<HTMLElement>(`[data-settings-focus="${key}"]`);
    const el = host?.matches("button, select, input, a")
      ? host
      : host?.querySelector<HTMLElement>("button, select, input, a");
    return el && !(el as HTMLButtonElement).disabled ? el : null;
  }

  provideSettingsNav({
    navigate: (next) => void navigate(next),
    openManuscript: (tab) => onOpenManuscript?.(tab),
  });

  // Settings stays mounted under a dialog that links back into it, so a new
  // request has to move an open Settings, not only a fresh one.
  let applied = untrack(() => request);
  $effect(() => {
    const seq = request;
    if (seq === applied) return;
    applied = seq;
    const next = untrack(() => initial);
    if (next) void navigate(next);
  });

  onMount(() => {
    // Tasks and Models share one view of the models, and Access and Activity
    // one view of the apps and their log. Settings loads them and lets them
    // go, rather than each page, so moving between two never disposes what
    // the other just loaded, which would stop a download's bar.
    if (isTauri()) {
      void models.open();
      void mcp.load();
    }
    // Opened by a link: land where it pointed. Opened from the top bar, App
    // decides (focus on the page under Settings moves to the current item).
    const first = untrack(() => initial);
    if (first) void navigate(first);
  });

  // The Manuscript dialog's Continuity tab may still show them, over Settings.
  onDestroy(() => models.close());

  /**
   * The rail is a list of destinations, every one in the Tab order. Up and
   * Down move focus along it, Home and End to its ends; nothing opens until
   * Enter, Space or a click, so walking the list never changes the page.
   */
  function onRailKey(event: KeyboardEvent): void {
    const items = [...rail.querySelectorAll<HTMLButtonElement>(".v-rail-item")];
    const at = items.indexOf(event.currentTarget as HTMLButtonElement);
    const to =
      event.key === "ArrowDown"
        ? Math.min(at + 1, items.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(at - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    items[to].focus();
  }
</script>

<div class="flex min-h-0 flex-1" role="region" aria-label={t("settings.title")}>
  <nav
    bind:this={rail}
    class="v-rail flex flex-shrink-0 flex-col overflow-y-auto p-3"
    style="width: 210px; border-right: 1px solid var(--border);"
    aria-label={t("settings.nav")}
  >
    <h2 class="v-rail-title">{t("settings.title")}</h2>

    {#each CATEGORIES as category (category.id)}
      <h3 id="settings-cat-{category.id}" class="v-rail-label">{t(`settings.categories.${category.id}`)}</h3>
      <ul class="v-rail-list" aria-labelledby="settings-cat-{category.id}">
        {#each category.pages as page (page)}
          <li>
            <button
              class="v-rail-item"
              aria-current={active === page ? "page" : undefined}
              onclick={() => void navigate({ page })}
              onkeydown={onRailKey}
            >
              {t(`settings.groups.${page}`)}
            </button>
          </li>
        {/each}
      </ul>
    {/each}

    <hr class="v-rail-sep" />
    <ul class="v-rail-list">
      {#each FOOTER as page (page)}
        <li>
          <button
            class="v-rail-item"
            aria-current={active === page ? "page" : undefined}
            onclick={() => void navigate({ page })}
            onkeydown={onRailKey}
          >
            {t(`settings.groups.${page}`)}
          </button>
        </li>
      {/each}
    </ul>

    <button
      class="v-btn mt-4"
      style="justify-content: flex-start; padding: 6px 10px; font-size: 12.5px;"
      onclick={onClose}
    >
      {t("settings.backToWriting")}
    </button>
  </nav>

  <!-- Not a named region: the pages carry their own regions ("Author",
       "Backup"), and a pane named for the page would collide with them. -->
  <div bind:this={pane} class="min-h-0 flex-1 overflow-y-auto" style="background: var(--bg-editor);">
    <div style="max-width: 760px; padding: 24px 28px;">
      <header class="mb-5">
        <h2 bind:this={title} id="settings-page-title" class="v-page-title" tabindex="-1">
          {t(`settings.groups.${active}`)}
        </h2>
        <!-- Why this page exists, in one line: a writer should never have to
             guess what a setting belongs to. -->
        <p class="v-muted m-0 mt-1" style="font-size: 12.5px; line-height: 1.6;">
          {t(`settings.purpose.${active}`)}
        </p>
      </header>

      {#if active === "editor"}
        <EditorGroup />
      {:else if active === "author"}
        <AuthorGroup />
      {:else if active === "appearance"}
        <AppearanceGroup />
      {:else if active === "tasks"}
        <TasksGroup />
      {:else if active === "models"}
        <ModelsGroup />
      {:else if active === "backup"}
        <BackupGroup />
      {:else if active === "assistants"}
        <AssistantsGroup />
      {:else if target.page === "access"}
        <AccessGroup client={target.client} />
      {:else if target.page === "activity"}
        <ActivityGroup client={target.client} />
      {:else}
        <AppGroup />
      {/if}
    </div>
  </div>
</div>
