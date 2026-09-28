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
  import RewriteDialog from "$lib/components/RewriteDialog.svelte";
  import ManuscriptDialog from "$lib/components/ManuscriptDialog.svelte";
  import { detectAgents } from "$lib/ai/agents";

  let showSettings = $state(false);
  let showNewProject = $state(false);
  let showNewChapter = $state(false);
  let showGit = $state(false);
  let gitDirty = $state(false);
  let showRewrite = $state(false);
  let showManuscript = $state(false);
  let rewriteSel = $state<{ from: number; to: number; text: string } | null>(null);

  let editorRef: {
    rollbackWord: () => boolean;
    rollbackSelection: () => boolean;
    flushOps: () => Promise<void>;
    getSelection: () => { from: number; to: number; text: string } | null;
    applyExternal: (from: number, to: number, text: string, expected?: string) => boolean;
    getDoc: () => string;
  } | undefined = $state(undefined);

  function onOps(path: string, chapter: string, body: string, ops: Op[]): Promise<unknown> {
    return api.opsAppend(path, chapter, body, ops);
  }

  async function doCommit(): Promise<void> {
    const path = store.project?.path;
    if (!path || store.loading) return;
    try {
      await store.flushAll();
      await api.gitCommit(path, t("git.checkpoint"));
      await refreshGit();
    } catch (e) { store.error = store.codeMessagePublic(e); }
  }

  function doRewrite(): void {
    if (!store.project || !store.currentChapter || store.loading) return;
    const sel = editorRef?.getSelection() ?? null;
    if (!sel) {
      store.error = t("ai.selectFirst");
      return;
    }
    rewriteSel = sel;
    showRewrite = true;
  }

  /** Checkpoint → Rust write → editor splice → adopt as saved. Throws to keep the dialog open. */
  async function applyRewrite(result: string, provider: string): Promise<void> {
    const sel = rewriteSel;
    const path = store.project?.path;
    const chapter = store.currentChapter;
    if (!sel || !path || !chapter || !editorRef) return;
    if (editorRef.getDoc().slice(sel.from, sel.to) !== sel.text) throw "stale_selection";
    await store.flushAll();
    const meta = await api.aiApplyRewrite({
      path, file: chapter.file, from: sel.from, to: sel.to, text: result, provider, expected: sel.text,
    });
    if (editorRef.applyExternal(sel.from, sel.to, result, sel.text)) {
      store.adoptSaved(editorRef.getDoc(), meta);
    } else {
      // Rust already wrote the file; re-read it rather than let the editor diverge.
      await store.openChapter(meta);
    }
    showRewrite = false;
    rewriteSel = null;
    await refreshGit();
  }

  function onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      doRewrite();
    }
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

  onMount(() => {
    store.beforeLeave = () => editorRef?.flushOps() ?? Promise.resolve();
    void (async () => {
      await initLocale();
      await initTheme();
      if (isTauri()) {
        await store.refreshProjects();
        // Probing five CLIs takes seconds; warm the cache so Rewrite opens ready.
        void detectAgents().catch(() => undefined);
      }
    })();
    const checkpoint = setInterval(async () => {
      const path = store.project?.path;
      if (!path || !isTauri() || store.loading) return;
      try {
        await store.flushAll();
        await api.gitAutoCheckpoint(path);
        await refreshGit();
      } catch (e) { store.error = store.codeMessagePublic(e); }
    }, 60_000);
    const poll = setInterval(() => void refreshGit(), 15_000);
    window.addEventListener("keydown", onKeydown);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isTauri()) void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const off = await window.onCloseRequested(async event => {
        event.preventDefault();
        try { await store.flushAll(); await window.destroy(); }
        catch (e) { store.error = store.codeMessagePublic(e); }
      });
      if (disposed) off(); else unlisten = off;
    });
    return () => {
      disposed = true;
      clearInterval(checkpoint);
      clearInterval(poll);
      window.removeEventListener("keydown", onKeydown);
      unlisten?.();
      store.beforeLeave = undefined;
    };
  });
</script>

<div class="flex h-full flex-col">
  <TopBar
    onOpenSettings={() => (showSettings = true)}
    onToggleGit={() => (showGit = !showGit)}
    onCommit={doCommit}
    onRewrite={doRewrite}
    onOpenManuscript={() => (showManuscript = true)}
    onRollbackWord={doRollbackWord}
    onRollbackSelection={doRollbackSelection}
    gitDirty={gitDirty}
  />

  <div class="flex min-h-0 flex-1">
    <ChapterList onRequestNewChapter={() => (showNewChapter = true)} />

    <main class="min-w-0 flex-1" style="background: var(--bg-editor);">
      {#if store.project && store.currentChapter}
        {#key store.project.path + "/" + store.currentChapter.file}
        <MarkdownEditor
          bind:this={editorRef}
          doc={store.chapterBody}
          chapterId={store.currentChapter.id}
          projectPath={store.project.path}
          disabled={store.loading}
          onChange={(body) => store.updateBody(body)}
          onOps={onOps}
          onOpsError={(e) => { store.error = store.codeMessagePublic(e); }}
        />
        {/key}
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
  {#if showManuscript}
    <ManuscriptDialog onClose={() => (showManuscript = false)} />
  {/if}
  {#if showRewrite && rewriteSel}
    <RewriteDialog
      text={rewriteSel.text}
      onClose={() => { showRewrite = false; rewriteSel = null; }}
      onApply={applyRewrite}
    />
  {/if}
</div>
