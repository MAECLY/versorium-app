<script lang="ts">
  import VMark from "$lib/components/VMark.svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { chordAria, chordLabel, platformOf } from "$lib/chrome/keys";
  import { keepFocusOnPress } from "$lib/components/restoreFocus";

  /**
   * The top bar carries what acts on the *manuscript*: the creative action, the
   * export, and getting to another project or to settings. Document state, view
   * modes and the editing-history controls moved to the status bar, where the
   * industry has put them for years (VS Code, Scrivener, iA Writer) and where
   * they stop competing with the one button a writer came here to press.
   */
  let {
    onOpenSettings,
    onRewrite,
    onOpenManuscript,
    onHide,
    inert = false,
    onAction,
  }: {
    onOpenSettings: () => void;
    onRewrite: () => void;
    onOpenManuscript: () => void;
    /** Fold the bar away (its Hide button). */
    onHide: () => void;
    /** Folded: out of the tab order and the accessibility tree at once. */
    inert?: boolean;
    /**
     * Runs before every action. When the bar is a peek, App closes it and
     * puts the caret back first, so a dialog the action opens returns focus
     * to the manuscript and not to a button that is about to go inert.
     */
    onAction?: () => void;
  } = $props();

  const platform = platformOf();
  const hideName = $derived(t("chrome.hideTopBar"));

  /** An action, after App has had its say. */
  function act(run: () => void): () => void {
    return () => {
      onAction?.();
      run();
    };
  }

  let version = $state("");
  let hasProject = $state(false);

  $effect(() => {
    hasProject = store.project !== null;
  });

  if (isTauri()) {
    api.appInfo().then((i) => (version = i.version)).catch(() => {});
  }

  function openProject(): void {
    if (!isTauri()) return;
    api.pickDirectory().then((p) => {
      if (typeof p === "string") void store.openProject(p);
    });
  }
</script>

<header
  id="topbar"
  class="v-row flex-shrink-0 border-b px-4"
  style="border-color: var(--border); height: 48px; gap: 12px;"
  {inert}
>
  <!-- Needle mark (favicon shape) -->
  <VMark size={20} />

  <span style="font-weight: 600; letter-spacing: 0.01em;">{t("app.name")}</span>

  <span class="v-muted" style="font-size: 12px;" aria-hidden="true">v{version}</span>

  <div class="v-row" style="margin-left: auto; gap: 8px;">
    {#if hasProject}
      <!-- The reason to open the app. Primary weight, and alone in its group. -->
      <button class="v-btn v-btn-primary" onclick={act(onRewrite)} title={t("ai.rewrite")}>
        {t("ai.rewrite")}
      </button>
      <!-- Creative Mode: visible, disabled, tooltip (spec §5). No engine in v1. -->
      <button class="v-btn" disabled aria-disabled="true" title={t("ai.creativeSoon")}>
        {t("ai.creative")}
      </button>

      <span class="v-bar-sep" aria-hidden="true"></span>

      <button class="v-btn" onclick={act(onOpenManuscript)} title={t("manuscript.title")}>
        {t("manuscript.open")}
      </button>
    {/if}
    <button class="v-btn" onclick={act(openProject)}>{t("app.openProject")}</button>
    <button class="v-btn" onclick={act(onOpenSettings)}>{t("settings.title")}</button>

    <span class="v-bar-sep" aria-hidden="true"></span>

    <!-- The top bar's Hide, at its far end. Its whole name on the button: a
         bare "Hide" in an app's chrome reads as macOS's ⌘H, hide the app, and
         only a tooltip (late or never in WKWebView) said which bar. Fits at
         1024 in Spanish with 113px to spare. A press leaves focus where it
         was, so hiding while writing keeps the caret. -->
    <button
      class="v-btn v-btn-small"
      aria-controls="topbar"
      aria-keyshortcuts={chordAria("toggleTopBar", platform)}
      title={t("chrome.withKeys", { label: hideName, keys: chordLabel("toggleTopBar", platform) })}
      onmousedown={keepFocusOnPress}
      onclick={onHide}
    >
      {hideName}
    </button>
  </div>
</header>
