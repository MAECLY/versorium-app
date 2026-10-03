<script lang="ts">
  import VMark from "$lib/components/VMark.svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";

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
  }: {
    onOpenSettings: () => void;
    onRewrite: () => void;
    onOpenManuscript: () => void;
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
  <VMark size={20} />

  <span style="font-weight: 600; letter-spacing: 0.01em;">{t("app.name")}</span>

  <span class="v-muted" style="font-size: 12px;" aria-hidden="true">v{version}</span>

  <div class="v-row" style="margin-left: auto; gap: 8px;">
    {#if hasProject}
      <!-- The reason to open the app. Primary weight, and alone in its group. -->
      <button class="v-btn v-btn-primary" onclick={onRewrite} title={t("ai.rewrite")}>
        {t("ai.rewrite")}
      </button>
      <!-- Creative Mode: visible, disabled, tooltip (spec §5). No engine in v1. -->
      <button class="v-btn" disabled aria-disabled="true" title={t("ai.creativeSoon")}>
        {t("ai.creative")}
      </button>

      <span class="v-bar-sep" aria-hidden="true"></span>

      <button class="v-btn" onclick={onOpenManuscript} title={t("manuscript.title")}>
        {t("manuscript.open")}
      </button>
    {/if}
    <button class="v-btn" onclick={openProject}>{t("app.openProject")}</button>
    <button class="v-btn" onclick={onOpenSettings}>{t("settings.title")}</button>
  </div>
</header>
