<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type ChapterMeta, type Project } from "$lib/tauri";

  /**
   * Two states, not one.
   *
   * This used to render the same thing whenever no project was *open*, so a
   * writer with three novels in the sidebar was told "Create a project to start
   * writing" under a button reading "Create your first project". Both were
   * false, and the second one every time they closed a novel.
   *
   * With novels on disk the question is not "shall I begin" but "where was I",
   * so the primary action is the last thing they were writing.
   */
  let {
    onRequestNew,
    onRequestTour,
  }: {
    onRequestNew: () => void;
    /** Only offered on a genuinely first run; the way back lives in Settings. */
    onRequestTour?: () => void;
  } = $props();

  let projects = $derived(store.projects);
  let first = $derived(projects.length === 0);

  /** The project list arrives most-recently-written first. */
  let resume = $derived.by<{ project: Project; chapter: ChapterMeta | null } | null>(() => {
    const project = projects[0];
    if (!project) return null;
    const chapter = [...project.chapters].sort((a, b) => b.mtime - a.mtime)[0] ?? null;
    return { project, chapter };
  });

  async function open(): Promise<void> {
    if (!resume) return;
    await store.openProject(resume.project.path);
    if (resume.chapter) await store.openChapter(resume.chapter);
  }

  function openFolder(): void {
    if (!isTauri()) return;
    void api.pickDirectory().then((p) => {
      if (typeof p === "string") void store.openProject(p);
    });
  }
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

  {#if first}
    <h1 class="m-0" style="font-size: 22px; font-weight: 600;">{t("empty.title")}</h1>
    <!-- The promise is worth making once, at the moment somebody decides
         whether to trust the app with a manuscript. -->
    <p class="v-muted m-0 max-w-sm text-center" style="font-size: 14px; line-height: 1.6;">
      {t("empty.body")}
    </p>
  {:else}
    <h1 class="m-0" style="font-size: 22px; font-weight: 600;">{t("empty.backTitle")}</h1>
    {#if resume?.chapter}
      <p class="v-muted m-0 max-w-sm text-center" style="font-size: 14px; line-height: 1.6;">
        {t("empty.backBody", { novel: resume.project.meta.title })}
      </p>
    {/if}
  {/if}

  {#if isTauri()}
    <div class="v-row" style="gap: 8px; flex-wrap: wrap; justify-content: center;">
      {#if first}
        <button class="v-btn v-btn-primary" onclick={onRequestNew}>{t("empty.cta")}</button>
      {:else if resume}
        <button class="v-btn v-btn-primary" onclick={() => void open()}>
          {resume.chapter
            ? t("empty.resumeChapter", { chapter: resume.chapter.title })
            : t("empty.resume", { novel: resume.project.meta.title })}
        </button>
        <button class="v-btn" onclick={onRequestNew}>{t("empty.newNovel")}</button>
      {/if}
      <!-- Somebody arriving from another machine or a restored backup already
           has novels on disk, and until now had no way in from here. -->
      <button class="v-btn" onclick={openFolder}>{t("empty.openFolder")}</button>
    </div>

    {#if first && onRequestTour}
      <button
        class="v-btn"
        style="background: transparent; border-color: transparent; font-size: 12px;"
        onclick={onRequestTour}
      >
        {t("empty.tour")}
      </button>
    {/if}
  {/if}
</div>
