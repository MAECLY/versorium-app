<script lang="ts">
  import { t, toggleLocale, getLocale } from "$lib/i18n";
  import { api, isTauri } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";

  let {
    onOpenSettings,
    onToggleGit,
    onCommit,
    onRewrite,
    onRollbackWord,
    onRollbackSelection,
    gitDirty,
  }: {
    onOpenSettings: () => void;
    onToggleGit: () => void;
    onCommit: () => void;
    onRewrite: () => void;
    onRollbackWord: () => void;
    onRollbackSelection: () => void;
    gitDirty: boolean;
  } = $props();

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
  class="v-row flex-shrink-0 border-b px-4"
  style="border-color: var(--border); height: 48px; gap: 12px;"
>
  <!-- Needle mark (favicon shape) -->
  <svg width="20" height="20" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="none" stroke="var(--accent)" stroke-width="6" />
    <path d="M50 10 L62 50 L50 90 L38 50 Z" fill="var(--accent)" transform="rotate(45 50 50)" />
    <circle cx="50" cy="50" r="8" fill="var(--bg-app)" />
  </svg>

  <span style="font-weight: 600; letter-spacing: 0.01em;">{t("app.name")}</span>

  <span class="v-muted" style="font-size: 12px;" aria-hidden="true">v{version}</span>

  <div class="v-row" style="margin-left: auto; gap: 8px;">
    {#if hasProject}
      <span
        aria-hidden="true"
        title={gitDirty ? t("git.dirty") : t("git.clean")}
        style="width: 8px; height: 8px; border-radius: 50%; background: {gitDirty ? "var(--warn)" : "var(--text-mute)"}; opacity: {gitDirty ? 1 : 0.4};"
      ></span>
      <button class="v-btn" onclick={onCommit} title={t("git.commitHint")}>{t("git.commit")}</button>
      <button class="v-btn" onclick={onRewrite} title={t("ai.rewrite")}>{t("ai.rewrite")}</button>
      <!-- Creative Mode: visible, disabled, tooltip (spec §5). No engine in v1. -->
      <button class="v-btn" disabled aria-disabled="true" title={t("ai.creativeSoon")}>
        {t("ai.creative")}
      </button>
      <button class="v-btn" onclick={onRollbackSelection} title={t("git.rollbackSelection")}>
        {t("git.rollbackSelShort")}
      </button>
      <button class="v-btn" onclick={onRollbackWord} title={t("git.rollbackWord")}>
        {t("git.rollbackWordShort")}
      </button>
      <button class="v-btn" onclick={onToggleGit} title={t("git.title")}>{t("git.title")}</button>
    {/if}
    <button class="v-btn" onclick={openProject}>{t("app.openProject")}</button>
    <button class="v-btn" onclick={toggleLocale} title="EN / ES">
      {getLocale() === "en" ? "ES" : "EN"}
    </button>
    <button class="v-btn" onclick={onOpenSettings}>{t("settings.title")}</button>
  </div>
</header>
