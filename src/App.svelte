<script lang="ts">
  import { onMount, tick } from "svelte";
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
  import { editorPreferences } from "$lib/editor/state.svelte";
  import NewProjectDialog from "$lib/binder/NewProjectDialog.svelte";
  import NewChapterDialog from "$lib/binder/NewChapterDialog.svelte";
  import SettingsPage from "$lib/settings/SettingsPage.svelte";
  import RewriteDialog from "$lib/components/RewriteDialog.svelte";
  import ManuscriptDialog from "$lib/components/ManuscriptDialog.svelte";
  import UpdateDialog from "$lib/components/UpdateDialog.svelte";
  import ItemActionDialogs from "$lib/binder/ItemActionDialogs.svelte";
  import { installContextMenuPolicy, installReloadKeyGuard } from "$lib/contextmenu/policy";
  import { detectAgents } from "$lib/ai/agents";
  import { updates } from "$lib/update/state.svelte";
  import { answerQuit } from "$lib/app/quit";
  import CollapsedEdge from "$lib/components/CollapsedEdge.svelte";
  import { closeOpenMenu } from "$lib/components/Menu.svelte";
  import { restoreFocus } from "$lib/components/restoreFocus";
  import { chrome } from "$lib/chrome/state.svelte";
  import { isEditorOnScreen, resolveChrome, type Command, type Surface } from "$lib/chrome/chrome";
  import { chordAria, chordLabel, matchChord, platformOf } from "$lib/chrome/keys";

  let showSettings = $state(false);
  let showNewProject = $state(false);
  let showNewChapter = $state(false);
  let showGit = $state(false);
  let gitDirty = $state(false);
  let showRewrite = $state(false);
  let showManuscript = $state(false);
  let dismissedUpdate = $state(false);
  let rewriteSel = $state<{ from: number; to: number; text: string } | null>(null);
  let typewriter = $state(false);
  let corkboard = $state(false);

  /** Typewriter is restored at launch: it hides nothing. Focus is not saved. */
  function persistModes(): void {
    if (!isTauri()) return;
    void api
      .setSettings({ typewriter })
      .catch(() => undefined);
  }

  function toggleTypewriter(): void {
    typewriter = !typewriter;
    persistModes();
  }

  // ---------------------------------------------------------------- chrome
  //
  // The panel, the top bar and Focus (src/lib/chrome/). The model decides what
  // each surface shows; this decides where keyboard focus goes, which moves
  // only when it would otherwise be lost or when a peek opens.

  const platform = platformOf();

  const editorOnScreen = $derived(
    isEditorOnScreen({
      project: store.project !== null,
      chapter: store.currentChapter !== null,
      loading: store.loading,
      corkboard,
      settings: showSettings,
    }),
  );
  const resolved = $derived(resolveChrome(chrome.model, { editorOnScreen }));
  const focusActive = $derived(resolved.focusActive);
  const binderView = $derived(resolved.view.binder);
  const topBarView = $derived(resolved.view.topBar);
  /** A chapter is open, or one is on its way: something for Focus to clear the page for. */
  const canFocus = $derived(store.project !== null && (store.currentChapter !== null || store.loading));
  const awake = $derived(chrome.wake.awake || chrome.peek !== null || chrome.menuOpen);
  const quiet = $derived(focusActive && !awake);

  const SURFACE_ID: Record<Surface, string> = { binder: "binder", topBar: "topbar" };
  const EDGE_SELECTOR: Record<Surface, string> = { binder: ".v-edge-rail", topBar: ".v-edge-lip" };

  function runChrome(cmd: Command): void {
    chrome.run(cmd, { editorOnScreen });
  }

  function surfaceEl(s: Surface): HTMLElement | null {
    return document.getElementById(SURFACE_ID[s]);
  }

  function edgeEl(s: Surface): HTMLElement | null {
    return document.querySelector<HTMLElement>(EDGE_SELECTOR[s]);
  }

  /** The surface's own Hide: the control that undoes a Show. */
  function hideEl(s: Surface): HTMLElement | null | undefined {
    return surfaceEl(s)?.querySelector<HTMLElement>('[aria-controls="' + SURFACE_ID[s] + '"]');
  }

  function caretBack(): boolean {
    return restoreFocus(document.querySelector("main .cm-content"));
  }

  function holdsFocus(el: Element | null): boolean {
    return !!el && el.contains(document.activeElement);
  }

  /** Focus is nowhere: on <body>, where WebKit leaves it after a press on a button. */
  function focusLost(): boolean {
    const el = document.activeElement;
    return el === null || el === document.body;
  }

  /**
   * For focus that is nowhere after a fold or an unfold. A press on Hide, the
   * rail or the lip moves no focus, but WebKit drops it to <body> on a click
   * on any other button, so it may already have been nowhere. It goes to the
   * caret when the manuscript is on screen, otherwise to the control that
   * undoes this one.
   */
  function landFocus(fallback: Element | null | undefined): void {
    if (!caretBack()) restoreFocus(fallback);
  }

  /**
   * What a peek of `s` stays open for: itself, its own edge (the button that
   * toggles it), and a menu or dialog opened from it.
   */
  function keepsPeek(el: Element | null, s: Surface): boolean {
    return !!el?.closest(`#${SURFACE_ID[s]}, ${EDGE_SELECTOR[s]}, [role="menu"], .v-menu-pop, dialog`);
  }

  function announceSurface(s: Surface, shown: boolean): void {
    const key = s === "binder" ? (shown ? "binderShown" : "binderHidden") : shown ? "topBarShown" : "topBarHidden";
    void chrome.announce(t(`chrome.${key}`));
  }

  /**
   * Hide, from the surface's own Hide or its chord. An open surface folds and
   * that is remembered; a peek only closes. Focus inside the folding surface
   * goes to the rail or lip, never down with it. A click on Hide or a chord
   * typed in the manuscript leaves the caret where it is, and focus that
   * was already nowhere lands in the manuscript (landFocus).
   */
  async function hideSurface(s: Surface, announce: boolean): Promise<void> {
    const view = resolved.view[s];
    if (view === "collapsed") return;
    const panel = surfaceEl(s);
    const inside = holdsFocus(panel);
    closeOpenMenu(panel);
    runChrome({ type: "hide", surface: s });
    if (announce) announceSurface(s, false);
    await tick();
    if (view === "peek") caretBack();
    else if (inside) restoreFocus(edgeEl(s));
    else if (focusLost()) landFocus(edgeEl(s));
  }

  /**
   * Show, from the rail, the lip or the chord. Where Focus hid the surface it
   * floats over the page and takes focus; otherwise it opens in the layout,
   * focus on the edge, which is about to go, moves to its Hide, and focus
   * that was nowhere lands in the manuscript (landFocus).
   */
  async function showSurface(s: Surface, announce: boolean): Promise<void> {
    const peeks = resolved.hiddenByFocus[s];
    const onEdge = holdsFocus(edgeEl(s));
    runChrome({ type: "show", surface: s });
    if (announce) announceSurface(s, true);
    await tick();
    if (peeks) focusIntoPeek(s);
    else if (onEdge) restoreFocus(hideEl(s));
    else if (focusLost()) landFocus(hideEl(s));
  }

  function toggleSurface(s: Surface, announce: boolean): void {
    if (resolved.view[s] === "collapsed") void showSurface(s, announce);
    else void hideSurface(s, announce);
  }

  /** The current chapter's row, or the first row; Rewrite, or the first button that works. */
  function focusIntoPeek(s: Surface): void {
    const panel = surfaceEl(s);
    if (!panel) return;
    if (s === "binder") {
      const row =
        panel.querySelector('[data-item-key^="chapter:"][aria-current="true"]') ??
        panel.querySelector("[data-item-key]");
      if (restoreFocus(row)) return;
    } else if (restoreFocus(panel.querySelector(".v-btn-primary"))) {
      return;
    }
    const first = [...panel.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.disabled);
    restoreFocus(first);
  }

  /** Close a peek and hand the caret back, for Escape and for a choice made in it. */
  async function closePeek(caret: boolean): Promise<void> {
    if (!chrome.peek) return;
    runChrome({ type: "closePeek" });
    if (!caret) return;
    await tick();
    caretBack();
  }

  /**
   * A project or chapter chosen in the peek: it closes, and the caret goes
   * into the chapter, which the editor re-keys on, so it waits a frame for
   * the new editor when the first try finds the old one gone.
   */
  async function afterNavigate(): Promise<void> {
    if (chrome.peek !== "binder") return;
    runChrome({ type: "closePeek" });
    await tick();
    if (!caretBack()) requestAnimationFrame(() => caretBack());
  }

  /** Any top-bar action from a peek: close it and put the caret back first. */
  function beforeTopBarAction(): void {
    if (chrome.peek !== "topBar") return;
    runChrome({ type: "closePeek" });
    caretBack();
  }

  async function setFocus(on: boolean): Promise<void> {
    if (on === chrome.focus) return;
    if (!on) {
      runChrome({ type: "setFocus", value: false });
      chrome.hideHint();
      void chrome.announce(t("editor.focusOff"));
      return;
    }
    if (!canFocus) return;
    // Both replace the page, which leaves nothing to concentrate on.
    corkboard = false;
    showSettings = false;
    for (const s of ["binder", "topBar"] as const) {
      if (chrome.recipe[s]) closeOpenMenu(surfaceEl(s));
    }
    runChrome({ type: "setFocus", value: true });
    void chrome.announce(t("editor.focusOn"));
    chrome.showHintOnce();
    await tick();
    caretBack();
  }

  function toggleFocus(): void {
    void setFocus(!chrome.focus);
  }

  function setRecipe(s: Surface, hides: boolean): void {
    // A menu inside a surface this is about to fold (never Focus options,
    // which lives in the status bar) would be stranded there.
    if (hides && focusActive) closeOpenMenu(surfaceEl(s));
    runChrome({ type: "setRecipe", surface: s, value: hides });
  }

  function openSettings(): void {
    void setFocus(false);
    showSettings = true;
  }

  function toggleCorkboard(): void {
    if (!corkboard) void setFocus(false);
    corkboard = !corkboard;
  }

  // Focus with no chapter to show (the last one deleted, the project closed)
  // ends, rather than sitting pressed over a page with nothing on it.
  $effect(() => {
    if (chrome.focus && !canFocus) void setFocus(false);
  });

  // Only while Focus is active: the edges wake on pointer travel, measured on
  // window so it never depends on the sleeping edge being hit-testable, and a
  // press outside a peek, or keyboard focus leaving it, closes it without
  // moving focus.
  $effect(() => {
    if (!focusActive) return;
    const onMove = (event: PointerEvent): void => chrome.notePointer(event.clientX, event.clientY);
    const onDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".cm-content")) chrome.wakeNow();
      if (chrome.peek && !keepsPeek(target, chrome.peek)) void closePeek(false);
    };
    // A press where a sleeping edge waits lands on its bare slot (asleep,
    // the edge takes no click). It wakes the edges, above; it must not also
    // take the caret out of the manuscript.
    const onMouseDown = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.matches(".v-binder-slot, .v-topbar-slot")) {
        event.preventDefault();
      }
    };
    // Tab or Shift+Tab out of a peek: it is momentary, so it goes, rather
    // than float over the page after focus has moved on. A null
    // relatedTarget names nowhere and is left alone, as Menu.svelte does: a
    // window blur, or a press WebKit gives no focus to.
    const onFocusOut = (event: FocusEvent): void => {
      const peek = chrome.peek;
      if (!peek || !(event.relatedTarget instanceof Element)) return;
      const from = event.target instanceof Element ? event.target : null;
      if (keepsPeek(from, peek) && !keepsPeek(event.relatedTarget, peek)) void closePeek(false);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("focusout", onFocusOut);
    };
  });

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

  const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "OS"]);

  function onKeydown(event: KeyboardEvent): void {
    // A key typed into the manuscript puts the edges to sleep. First, because
    // CodeMirror prevents the default of Enter and Backspace, and those are
    // typing too.
    if (
      focusActive &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key !== "Escape" &&
      !MODIFIERS.has(event.key) &&
      event.target instanceof Element &&
      event.target.closest(".cm-content")
    ) {
      chrome.noteKeystroke();
    }

    // Rewrite and Restore ignore defaultPrevented: on Windows the reload guard
    // has already prevented Ctrl+Shift+R and Ctrl+Alt+R for the webview.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      doRewrite();
    }
    // Restore has no bar button of its own beyond the status bar, so it needs a
    // key: same modifier family as Rewrite, since both act on the selection.
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      doRestore();
    }

    // A modal dialog owns the keyboard.
    if (document.querySelector("dialog[open]")) return;

    const chord = matchChord(event, platform);
    if (chord === "toggleBinder" && !showSettings) {
      event.preventDefault();
      if (!event.repeat) toggleSurface("binder", true);
      return;
    }
    if (chord === "toggleTopBar") {
      event.preventDefault();
      if (!event.repeat) toggleSurface("topBar", true);
      return;
    }
    if (chord === "toggleFocus" && canFocus) {
      event.preventDefault();
      if (!event.repeat) toggleFocus();
      return;
    }

    // Escape peels one layer per press: an open menu (its own handler, which
    // stops the key before it gets here), then a peek, then Focus. A key
    // something else already used is not ours: CodeMirror's search panel,
    // the completion list, collapsing a selection.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.querySelector('[role="menu"]')) {
      // Reaching here means focus already left the menu, so its own handler
      // never saw the key. It closes now, and nothing else does.
      closeOpenMenu();
      return;
    }
    if (chrome.peek) {
      event.preventDefault();
      void closePeek(true);
      return;
    }
    if (focusActive) {
      event.preventDefault();
      void setFocus(false);
    }
  }

  function doRestore(): void {
    if (!editorRef) return;
    const sel = editorRef.getSelection();
    const done = sel ? editorRef.rollbackSelection() : editorRef.rollbackWord();
    if (!done) store.error = t("git.nothingToRollback");
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
          // Not saved.focusMode: Focus lasts one session, so no launch opens
          // into a window with its bars hidden by a mode left on last week.
          chrome.load(saved);
          typewriter = saved.typewriter ?? false;
          editorPreferences.adopt(saved.editor);
          // Spec §14: the tour is the first run, and there is no signup.
          firstRun = saved.onboarded === false;
        } catch {
          // Defaults are fine; a writing mode is not worth an error.
        }
        chrome.settle();
        await store.refreshProjects();
        // Probing five CLIs takes seconds; warm the cache so Rewrite opens ready.
        void detectAgents().catch(() => undefined);
        // Quiet, once, and only if the writer asked for it (spec §11). A failure
        // here must never be the first thing they see.
        void updates.checkOnStartup().catch(() => undefined);
        if (firstRun) await onboarding.start();
      } else {
        chrome.settle();
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
    // Here and not in main.ts: if the app never mounts, the boot-failure
    // screen keeps the engine's Reload, its only way out.
    const uninstallMenus = installContextMenuPolicy();
    const uninstallKeys = installReloadKeyGuard();
    let unlisten: (() => void) | undefined;
    let unlistenQuit: (() => void) | undefined;
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
    // Cmd+Q and the Dock's Quit never reach onCloseRequested; Rust holds the
    // quit until this answers (src-tauri/src/quit.rs).
    if (isTauri()) void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const off = await listen("versorium://quit-requested", () =>
        answerQuit(
          () => store.flushAll(),
          (saved) => api.quitReady(saved),
          (e) => { store.error = t("app.quitUnsaved", { reason: store.codeMessagePublic(e) }); },
        ),
      );
      if (disposed) off(); else unlistenQuit = off;
    });
    return () => {
      disposed = true;
      clearInterval(checkpoint);
      clearInterval(poll);
      window.removeEventListener("keydown", onKeydown);
      uninstallMenus();
      uninstallKeys();
      unlisten?.();
      unlistenQuit?.();
      store.beforeLeave = undefined;
    };
  });
</script>

<!-- data-focus: Focus is clearing the page. data-awake: its edges are showing
     (pointer travel, a peek or Focus options keep them so). data-quiet: the
     status bar drops its borders while the writer types. data-ready: the
     saved layout is drawn, and transitions may run. -->
<div
  class="v-shell flex h-full flex-col"
  data-focus={focusActive || undefined}
  data-awake={awake || undefined}
  data-quiet={quiet || undefined}
  data-ready={chrome.ready || undefined}
>
  <div class="v-topbar-slot" data-view={topBarView}>
    {#if topBarView !== "open"}
      <CollapsedEdge
        kind="lip"
        text={t("chrome.showTopBar")}
        name={t("chrome.showTopBar")}
        expanded={topBarView === "peek"}
        controls="topbar"
        keys={chordAria("toggleTopBar", platform)}
        title={t("chrome.lipHint", {
          keys: chordLabel("toggleTopBar", platform),
          rewriteKeys: chordLabel("rewrite", platform),
        })}
        onclick={() => toggleSurface("topBar", false)}
      />
    {/if}
    <TopBar
      onOpenSettings={openSettings}
      onRewrite={doRewrite}
      onOpenManuscript={() => (showManuscript = true)}
      onHide={() => void hideSurface("topBar", false)}
      inert={topBarView === "collapsed"}
      onAction={beforeTopBarAction}
    />
  </div>

  {#if showSettings}
    <SettingsPage onClose={() => (showSettings = false)} />
  {:else}
  <div class="v-middle flex min-h-0 flex-1">
    <div class="v-binder-slot" data-view={binderView}>
      {#if binderView !== "open"}
        <!-- The panel's one name, as its menu item and announcements say it:
             "Chapters" alone named half of what Hide on the PROJECTS row
             had just folded away. -->
        <CollapsedEdge
          kind="rail"
          text={t("chrome.binderItem")}
          name={t("chrome.showBinder")}
          expanded={binderView === "peek"}
          controls="binder"
          keys={chordAria("toggleBinder", platform)}
          title={t("chrome.withKeys", { label: t("chrome.showBinder"), keys: chordLabel("toggleBinder", platform) })}
          onclick={() => toggleSurface("binder", false)}
        />
      {/if}
      <ChapterList
        onRequestNewChapter={() => (showNewChapter = true)}
        onHide={() => void hideSurface("binder", false)}
        inert={binderView === "collapsed"}
        onNavigate={() => void afterNavigate()}
      />
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
          typewriter={typewriter}
          preferences={editorPreferences.current}
          language={store.project.meta.language}
          onChange={(body) => store.updateBody(body)}
          onOps={onOps}
          onOpsError={(e) => { store.error = store.codeMessagePublic(e); }}
        />
        {/key}
      {:else}
        <EmptyState
          onRequestNew={() => (showNewProject = true)}
          onRequestTour={() => void onboarding.start()}
        />
      {/if}
    </main>
  </div>
  {/if}

  {#if showGit}
    <GitPanel open={showGit} onClose={() => (showGit = false)} />
  {/if}

  <StatusBar
    onCommit={doCommit}
    onToggleGit={() => (showGit = !showGit)}
    onRestore={doRestore}
    onToggleFocus={toggleFocus}
    onToggleTypewriter={toggleTypewriter}
    onToggleView={toggleCorkboard}
    onFocusRecipe={setRecipe}
    onFocusMenu={(open) => (chrome.menuOpen = open)}
    gitDirty={gitDirty}
    focus={chrome.focus}
    focusDisabled={!canFocus}
    focusRecipe={chrome.recipe}
    typewriter={typewriter}
    corkboard={corkboard}
    hint={chrome.hintVisible && focusActive}
  />

  <!-- Always in the DOM, so the first message is heard: a live region that
       appears with its text is often not announced at all. -->
  <div class="sr-only" role="status">{chrome.announcement}</div>

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

  <ItemActionDialogs />
  {#if showNewProject}
    <NewProjectDialog onClose={() => (showNewProject = false)} />
  {/if}
  {#if showNewChapter}
    <!-- A chapter made from the panel's + opens at once: from a peek, that is
         a chapter chosen, and the peek closes on it as a row's click does. -->
    <NewChapterDialog onClose={() => (showNewChapter = false)} onCreated={() => void afterNavigate()} />
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
