<script lang="ts">
  import { onMount } from "svelte";
  import { t, initLocale } from "$lib/i18n";
  import { initTheme } from "$lib/themes";
  import { store } from "$lib/binder/store.svelte";
  import { api, isTauri, type Op } from "$lib/tauri";
  import TopBar from "$lib/components/TopBar.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Onboarding from "$lib/onboarding/Onboarding.svelte";
  import { onboarding } from "$lib/onboarding/state.svelte";
  import GitPanel from "$lib/components/GitPanel.svelte";
  import ChapterList from "$lib/binder/ChapterList.svelte";
  import Corkboard from "$lib/binder/Corkboard.svelte";
  import MarkdownEditor from "$lib/editor/MarkdownEditor.svelte";
  import NewProjectDialog from "$lib/binder/NewProjectDialog.svelte";
  import NewChapterDialog from "$lib/binder/NewChapterDialog.svelte";
  import SettingsPage from "$lib/settings/SettingsPage.svelte";
  import RewriteDialog from "$lib/components/RewriteDialog.svelte";
  import ManuscriptDialog from "$lib/components/ManuscriptDialog.svelte";
  import UpdateDialog from "$lib/components/UpdateDialog.svelte";
  import { detectAgents } from "$lib/ai/agents";
  import { updates } from "$lib/update/state.svelte";

  let showSettings = $state(false);
  let showNewProject = $state(false);
  let showNewChapter = $state(false);
  let showGit = $state(false);
  let gitDirty = $state(false);
  let showRewrite = $state(false);
  let showManuscript = $state(false);
  let dismissedUpdate = $state(false);
  let rewriteSel = $state<{ from: number; to: number; text: string } | null>(null);
  let focusMode = $state(false);
  let typewriter = $state(false);
  let corkboard = $state(false);

  /** The Rust side adds these to the settings patch in M7; the shared
   *  AppSettings interface lives in a file this change does not own, so the
   *  two preferences are widened here until it catches up. */

  function persistModes(): void {
    if (!isTauri()) return;
    void api
      .setSettings({ focusMode, typewriter })
      .catch(() => undefined);
  }

  function toggleFocus(): void {
    focusMode = !focusMode;
    // Leaving focus mode with the corkboard open would show dimmed chrome over
    // a board that has no text to concentrate on.
    if (focusMode) corkboard = false;
    persistModes();
  }

  function toggleTypewriter(): void {
    typewriter = !typewriter;
    persistModes();
  }

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
      await api.gitCommit(
        path,
        t("git.snapshotOf", {
          when: new Date().toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        }),
      );
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
    // The way out of focus mode. The chrome also returns on hover, but a writer
    // who cannot find their way back out will force-quit, so Escape is the
    // guaranteed exit — unless a dialog is open, which owns Escape itself.
    if (event.key === "Escape" && focusMode && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      toggleFocus();
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
        let firstRun = false;
        try {
          const saved = await api.getSettings();
          focusMode = saved.focusMode ?? false;
          typewriter = saved.typewriter ?? false;
          // Spec §14: the tour is the first run, and there is no signup.
          firstRun = saved.onboarded === false;
        } catch {
          // Defaults are fine; a writing mode is not worth an error.
        }
        await store.refreshProjects();
        // Probing five CLIs takes seconds; warm the cache so Rewrite opens ready.
        void detectAgents().catch(() => undefined);
        // Quiet, once, and only if the writer asked for it (spec §11). A failure
        // here must never be the first thing they see.
        void updates.checkOnStartup().catch(() => undefined);
        if (firstRun) await onboarding.start();
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

<div class="flex h-full flex-col" class:v-focus={focusMode}>
  <div class="v-chrome flex-shrink-0">
    <TopBar
      onOpenSettings={() => (showSettings = true)}
      onToggleGit={() => (showGit = !showGit)}
      onCommit={doCommit}
      onRewrite={doRewrite}
      onOpenManuscript={() => (showManuscript = true)}
      onRollbackWord={doRollbackWord}
      onRollbackSelection={doRollbackSelection}
      onToggleFocus={toggleFocus}
      onToggleTypewriter={toggleTypewriter}
      onToggleView={() => (corkboard = !corkboard)}
      gitDirty={gitDirty}
      focus={focusMode}
      typewriter={typewriter}
      corkboard={corkboard}
    />
  </div>

  {#if showSettings}
    <SettingsPage onClose={() => (showSettings = false)} />
  {:else}
  <div class="flex min-h-0 flex-1">
    <div class="v-chrome flex-shrink-0">
      <ChapterList onRequestNewChapter={() => (showNewChapter = true)} />
    </div>

    <main class="min-w-0 flex-1" style="background: var(--bg-editor);">
      {#if store.project && corkboard}
        <Corkboard />
      {:else if store.project && store.currentChapter}
        {#key store.project.path + "/" + store.currentChapter.file}
        <MarkdownEditor
          bind:this={editorRef}
          doc={store.chapterBody}
          chapterId={store.currentChapter.id}
          projectPath={store.project.path}
          disabled={store.loading}
          focus={focusMode}
          typewriter={typewriter}
          onChange={(body) => store.updateBody(body)}
          onOps={onOps}
          onOpsError={(e) => { store.error = store.codeMessagePublic(e); }}
        />
        {/key}
      {:else}
        <EmptyState
          onRequestNew={() => (showNewProject = true)}
          onRequestSetup={() => void onboarding.start()}
        />
      {/if}
    </main>
  </div>
  {/if}

  {#if showGit}
    <GitPanel open={showGit} onClose={() => (showGit = false)} />
  {/if}

  <div class="v-chrome flex-shrink-0">
    <StatusBar />
  </div>

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

  {#if onboarding.open}
    <Onboarding onClose={() => (onboarding.open = false)} />
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
  {#if updates.available && !dismissedUpdate}
    <UpdateDialog onClose={() => (dismissedUpdate = true)} />
  {/if}
  {#if showRewrite && rewriteSel}
    <RewriteDialog
      text={rewriteSel.text}
      onClose={() => { showRewrite = false; rewriteSel = null; }}
      onApply={applyRewrite}
    />
  {/if}
</div>
