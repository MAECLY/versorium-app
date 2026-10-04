<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t, toggleLocale, getLocale } from "$lib/i18n";
  import FocusControl from "$lib/components/FocusControl.svelte";
  import type { Surface } from "$lib/chrome/chrome";

  /**
   * Three groups, left to right, separated so they read as three things rather
   * than one undifferentiated row: where you are, the state of the history, and
   * how you are looking at the page. This is the conventional split -- VS Code
   * puts the branch on the left of its status bar and the view/language
   * controls on the right; Scrivener and iA Writer put word count and view mode
   * down here too -- and it is what lets the top bar hold one primary action.
   *
   * It never folds away: it holds Focus, which is the way back from Focus.
   */
  let {
    onCommit,
    onToggleGit,
    onRestore,
    onToggleFocus,
    onToggleTypewriter,
    onToggleView,
    onFocusRecipe,
    onFocusMenu,
    gitDirty,
    focus,
    focusDisabled,
    focusRecipe,
    typewriter,
    corkboard,
    hint = false,
  }: {
    onCommit: () => void;
    onToggleGit: () => void;
    onRestore: () => void;
    onToggleFocus: () => void;
    onToggleTypewriter: () => void;
    onToggleView: () => void;
    onFocusRecipe: (surface: Surface, hides: boolean) => void;
    onFocusMenu: (open: boolean) => void;
    gitDirty: boolean;
    focus: boolean;
    /** No chapter open: nothing for Focus to clear the page for. */
    focusDisabled: boolean;
    focusRecipe: Record<Surface, boolean>;
    typewriter: boolean;
    corkboard: boolean;
    /** The first Focus of the session: say how to leave, in place of where you are. */
    hint?: boolean;
  } = $props();

  let words = $derived(
    store.chapterBody ? store.chapterBody.split(/\s+/).filter(Boolean).length : 0,
  );

  let hasProject = $derived(store.project !== null);
</script>

<footer
  class="v-status v-row flex-shrink-0 border-t px-3"
  style="border-color: var(--border); height: 32px; font-size: 12px; color: var(--text-mute); gap: 10px;"
>
  <!-- Where you are. The chapter's name is the one thing here that gives way
       when the bar runs out of room: it ends in an ellipsis, with the whole
       name in its tooltip. The visible hint is hidden from assistive
       technology, which hears it from App's live region instead. -->
  {#if hint}
    <span class="v-status-hint" aria-hidden="true">{t("editor.focusLeaveHint")}</span>
  {:else if store.currentChapter}
    {@const where = `${store.currentChapter.id} · ${store.currentChapter.title}`}
    <span class="v-muted v-status-where" title={where}>{where}</span>
    <span class="v-status-fixed">{t("statusbar.words", { words })}</span>
    <span class="v-status-fixed" style="color: {store.saveState === 'error' ? 'var(--warn)' : 'var(--ok)'}">
      {store.saveState === "saving"
        ? t("editor.saving")
        : store.saveState === "error"
          ? t("editor.unsaved")
          : t("editor.saved")}
    </span>
  {:else}
    <span class="v-status-where">{t("empty.title")}</span>
  {/if}

  {#if hasProject}
    <span class="v-bar-sep" aria-hidden="true"></span>

    <!-- The state of the history, and the two things you do about it. -->
    <span
      aria-hidden="true"
      title={gitDirty ? t("git.dirty") : t("git.clean")}
      style="width: 8px; height: 8px; border-radius: 50%; background: {gitDirty
        ? 'var(--warn)'
        : 'var(--text-mute)'}; opacity: {gitDirty ? 1 : 0.4}; flex-shrink: 0;"
    ></span>
    <button class="v-btn v-bar-btn" onclick={onCommit} title={t("git.commitHint")}>
      {t("git.commit")}
    </button>
    <button class="v-btn v-bar-btn" onclick={onToggleGit} title={t("git.title")}>
      {t("git.title")}
    </button>
    <!-- Acts on the selection, or the word under the cursor when there is none:
         the same rule Rewrite already follows, so there is nothing to choose. -->
    <button class="v-btn v-bar-btn" onclick={onRestore} title={t("git.restoreHint")}>
      {t("git.restore")}
    </button>

    <span style="margin-left: auto;"></span>

    <!-- How you are looking at the page -->
    <button
      class="v-btn v-bar-btn"
      onclick={onToggleView}
      aria-pressed={corkboard}
      title={t("binder.corkboardHint")}
    >
      {t("binder.corkboard")}
    </button>
    <FocusControl
      {focus}
      disabled={focusDisabled}
      recipe={focusRecipe}
      onToggle={onToggleFocus}
      onRecipe={onFocusRecipe}
      onMenuChange={onFocusMenu}
    />
    <button
      class="v-btn v-bar-btn"
      onclick={onToggleTypewriter}
      aria-pressed={typewriter}
      title={t("editor.typewriterHint")}
    >
      {t("editor.typewriter")}
    </button>

    <span class="v-bar-sep" aria-hidden="true"></span>
  {:else}
    <span style="margin-left: auto;"></span>
  {/if}

  <!-- Language sits where VS Code puts the language mode: the far right. -->
  <button class="v-btn v-bar-btn" onclick={toggleLocale} title="EN / ES">
    {getLocale() === "en" ? "ES" : "EN"}
  </button>
</footer>
