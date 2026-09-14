<script lang="ts">
  import { onMount } from "svelte";
  import { t, initLocale } from "$lib/i18n";
  import { initTheme } from "$lib/themes";
  import { store } from "$lib/binder/store.svelte";
  import { api, isTauri, type Op } from "$lib/tauri";
  import TopBar from "$lib/components/TopBar.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import GitPanel from "$lib/components/GitPanel.svelte";
  import ChapterList from "$lib/binder/ChapterList.svelte";
  import MarkdownEditor from "$lib/editor/MarkdownEditor.svelte";
  import NewProjectDialog from "$lib/binder/NewProjectDialog.svelte";
  import NewChapterDialog from "$lib/binder/NewChapterDialog.svelte";
  import SettingsModal from "$lib/settings/SettingsModal.svelte";

  let showSettings = $state(false);
  let showNewProject = $state(false);
  let showNewChapter = $state(false);
  let showGit = $state(false);
  let gitDirty = $state(false);

  let editorRef: {
    rollbackWord: () => boolean;
    rollbackSelection: () => boolean;
    flushOps: () => Promise<void>;
  } | undefined = $state(undefined);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function onEditorChange(body: string): void {
    store.chapterBody = body;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void store.saveChapter(body), 800);
  }

  /** Stable sink: derived ops go to the Rust ops log for the open chapter. */
  function onOps(body: string, ops: Op[]): Promise<unknown> {
    const ch = store.currentChapter;
    if (!store.project || !ch) return Promise.resolve();
    return api.opsAppend(store.project.path, ch.id, body, ops);
  }

  function doCommit(): void {
    if (!store.project) return;
    void editorRef?.flushOps();
    void store.saveChapter(store.chapterBody).then(() =>
      api.gitCommit(store.project!.path, t("git.checkpoint")),
    ).then(() => void refreshGit())
      .catch((e) => (store.error = store.codeMessagePublic(e)));
  }

  function doRollbackWord(): void {
    if (!editorRef?.rollbackWord()) store.error = t("git.nothingToRollback");
  }

  function doRollbackSelection(): void {
    if (!editorRef?.rollbackSelection()) store.error = t("git.nothingToRollback");
  }

  async function refreshGit(): Promise<void> {
    if (!store.project || !isTauri()) return;
    try {
      const st = await api.gitStatus(store.project.path);
      gitDirty = st.modified.length + st.staged.length + st.untracked.length > 0;
    } catch {
      gitDirty = false;
    }
  }

  onMount(async () => {
    await initLocale();
    await initTheme();
    if (isTauri()) {
      void store.refreshProjects();
      // Auto checkpoint: commit dirty work every 60 s while a project is open.
      setInterval(() => {
        if (!store.project) return;
        void store.saveChapter(store.chapterBody)
          .then(() => api.gitAutoCheckpoint(store.project!.path))
          .then(() => void refreshGit())
          .catch(() => {});
      }, 60_000);
      setInterval(() => void refreshGit(), 15_000);
    }
  });
</script>

<div class="flex h-full flex-col">
  <TopBar
    onOpenSettings={() => (showSettings = true)}
    onToggleGit={() => (showGit = !showGit)}
    onCommit={doCommit}
    onRollbackWord={doRollbackWord}
    onRollbackSelection={doRollbackSelection}
    gitDirty={gitDirty}
  />

  <div class="flex min-h-0 flex-1">
    <ChapterList onRequestNewChapter={() => (showNewChapter = true)} />

    <main class="min-w-0 flex-1" style="background: var(--bg-editor);">
      {#if store.project && store.currentChapter}
        <MarkdownEditor
          bind:this={editorRef}
          doc={store.chapterBody}
          chapterId={store.currentChapter.id}
          onChange={onEditorChange}
          onOps={onOps}
        />
      {:else}
        <EmptyState onRequestNew={() => (showNewProject = true)} />
      {/if}
    </main>
  </div>

  {#if showGit}
    <GitPanel open={showGit} onClose={() => (showGit = false)} />
  {/if}

  <StatusBar />

  {#if store.error}
    <div
      role="alert"
      class="v-row fixed bottom-10 left-1/2 z-40"
      style="transform: translateX(-50%); background: var(--bg-elev); border: 1px solid var(--warn); border-radius: var(--radius-card); padding: 8px 16px; font-size: 13px; color: var(--warn);"
    >
      <span>{store.error}</span>
      <button class="v-btn" style="padding: 0 6px;" onclick={() => (store.error = null)}>✕</button>
    </div>
  {/if}

  {#if showSettings}
    <SettingsModal onClose={() => (showSettings = false)} />
  {/if}
  {#if showNewProject}
    <NewProjectDialog onClose={() => (showNewProject = false)} />
  {/if}
  {#if showNewChapter}
    <NewChapterDialog onClose={() => (showNewChapter = false)} />
  {/if}
</div>
