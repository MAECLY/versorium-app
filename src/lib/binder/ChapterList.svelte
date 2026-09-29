<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";
  import type { ChapterMeta, ChapterStatus, Project } from "$lib/tauri";
  import ItemMenu from "$lib/binder/ItemMenu.svelte";
  import RenameDialog from "$lib/binder/RenameDialog.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import ProjectSettingsDialog from "$lib/binder/ProjectSettingsDialog.svelte";
  import CoverPreview from "$lib/components/CoverPreview.svelte";

  let { onRequestNewChapter }: { onRequestNewChapter: () => void } = $props();

  const STATUSES: ChapterStatus[] = ["draft", "revised", "final"];

  let renaming = $state<{ kind: "project" | "chapter"; id: string; title: string } | null>(null);
  let confirming = $state<{ kind: "project" | "chapter"; id: string; title: string } | null>(null);

  let settingsFor = $state<string | null>(null);

  let projectActions = $derived([
    { id: "rename", label: t("binder.menu.renameProject") },
    { id: "settings", label: t("binder.menu.projectSettings") },
    { id: "delete", label: t("binder.menu.deleteProject"), destructive: true },
  ]);

  /** Only the statuses it is not already, so the menu never offers a no-op. */
  function chapterActions(chapter: ChapterMeta) {
    const chapters = store.project?.chapters ?? [];
    const at = chapters.findIndex((c) => c.file === chapter.file);
    return [
      { id: "rename", label: t("binder.menu.renameChapter") },
      // Omitted rather than disabled at the ends: a menu item that cannot do
      // anything is a thing to read and then work out why.
      ...(at > 0 ? [{ id: "up", label: t("binder.menu.moveUp") }] : []),
      ...(at >= 0 && at < chapters.length - 1 ? [{ id: "down", label: t("binder.menu.moveDown") }] : []),
      ...STATUSES.filter((s) => s !== chapter.status).map((s) => ({
        id: `status:${s}`,
        label: t("binder.menu.markAs", { status: t(`binder.status.${s}`) }),
      })),
      { id: "delete", label: t("binder.menu.deleteChapter"), destructive: true },
    ];
  }

  function onProjectAction(project: Project, action: string): void {
    if (action === "rename") renaming = { kind: "project", id: project.path, title: project.meta.title };
    if (action === "settings") settingsFor = project.path;
    if (action === "delete") confirming = { kind: "project", id: project.path, title: project.meta.title };
  }

  function onChapterAction(chapter: ChapterMeta, action: string): void {
    if (action === "rename") renaming = { kind: "chapter", id: chapter.file, title: chapter.title };
    else if (action === "up") void store.moveChapter(chapter.file, -1);
    else if (action === "down") void store.moveChapter(chapter.file, 1);
    else if (action === "delete") confirming = { kind: "chapter", id: chapter.file, title: chapter.title };
    else if (action.startsWith("status:")) {
      void store.updateChapter(chapter.file, undefined, action.slice(7) as ChapterStatus);
    }
  }

  async function doRename(title: string): Promise<void> {
    const target = renaming;
    if (!target) return;
    if (target.kind === "project") await store.renameProject(target.id, title);
    else await store.updateChapter(target.id, title);
  }

  async function doDelete(): Promise<void> {
    const target = confirming;
    confirming = null;
    if (!target) return;
    if (target.kind === "project") await store.deleteProject(target.id);
    else await store.deleteChapter(target.id);
  }
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
      <div class="v-row" style="gap: 2px;">
      <button
        class="v-list-item {store.project?.path === p.path ? 'v-list-item-active' : ''}"
        style="flex: 1; min-width: 0;"
        aria-current={store.project?.path === p.path ? "true" : undefined}
        disabled={store.loading}
        onclick={() => store.openProject(p.path)}
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
      <ItemMenu
        label={t("binder.menu.forProject", { title: p.meta.title })}
        actions={projectActions}
        onChoose={(action) => onProjectAction(p, action)}
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
        <div class="v-row" style="gap: 2px;">
        <button
          class="v-list-item {active ? 'v-list-item-active' : ''}"
          style="flex: 1; min-width: 0;"
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
        <ItemMenu
          label={t("binder.menu.forChapter", { title: ch.title })}
          actions={chapterActions(ch)}
          onChoose={(action) => onChapterAction(ch, action)}
        />
        </div>
        </li>
      {:else}
        <li class="v-muted px-2" style="font-size: 12px;">{t("binder.noChapters")}</li>
      {/each}
    </ul>
  {/if}
</aside>

{#if renaming}
  <RenameDialog
    kind={renaming.kind}
    current={renaming.title}
    onClose={() => (renaming = null)}
    onRename={doRename}
  />
{/if}

{#if confirming}
  <ConfirmDialog
    title={t(`binder.confirm.${confirming.kind}Title`, { title: confirming.title })}
    body={t(`binder.confirm.${confirming.kind}Body`)}
    confirmLabel={t(confirming.kind === "project" ? "binder.menu.deleteProject" : "binder.menu.deleteChapter")}
    onCancel={() => (confirming = null)}
    onConfirm={doDelete}
  />
{/if}

{#if settingsFor}
  <ProjectSettingsDialog path={settingsFor} onClose={() => (settingsFor = null)} />
{/if}
