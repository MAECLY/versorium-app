<script lang="ts">
  import { t, setLocale, getLocale } from "$lib/i18n";
  import {
    THEME_NAMES,
    THEME_MODES,
    setTheme,
    setThemeMode,
    getTheme,
    getThemeMode,
  } from "$lib/themes";
  import { api, isTauri } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const placeholderSections: string[] = [
    "agents",
    "localAi",
    "mcp",
    "safety",
    "updates",
    "typography",
  ];

  // --- Git section state (two OAuth slots, never mixed) ---
  let updatesToken = $state("");
  let novelToken = $state("");
  let updatesLogin = $state("");
  let novelLogin = $state("");
  let repoName = $state("");
  let repoBusy = $state(false);
  let gitNotice = $state("");

  $effect(() => {
    if (isTauri()) {
      api
        .getSettings()
        .then((s) => {
          updatesToken = s.githubUpdatesToken ?? "";
          novelToken = s.githubNovelToken ?? "";
        })
        .catch(() => {});
    }
    if (store.project) repoName = store.project.path.split("/").pop() ?? "";
  });

  async function connect(slot: "updates" | "novel"): Promise<void> {
    const token = slot === "updates" ? updatesToken.trim() : novelToken.trim();
    gitNotice = "";
    if (!token) return;
    try {
      const login = await api.githubMe(token);
      if (slot === "updates") updatesLogin = login;
      else novelLogin = login;
      await api.setSettings(
        slot === "updates"
          ? { githubUpdatesToken: token }
          : { githubNovelToken: token },
      );
      gitNotice = t("git.connected") + ` @${login}`;
    } catch (e) {
      gitNotice = store.codeMessagePublic(e);
    }
  }

  async function createNovelRepo(): Promise<void> {
    const token = novelToken.trim();
    const name = repoName.trim();
    if (!token || !name || repoBusy) return;
    repoBusy = true;
    gitNotice = "";
    try {
      const url = await api.githubCreateRepo(token, name);
      if (store.project) await api.gitRemoteAdd(store.project.path, "origin", url);
      gitNotice = url;
    } catch (e) {
      gitNotice = store.codeMessagePublic(e);
    } finally {
      repoBusy = false;
    }
  }
</script>

<div class="v-dialog-backdrop" onclick={onClose} role="presentation">
  <div
    class="v-dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t("settings.title")}
    onclick={(e) => e.stopPropagation()}
    style="width: min(560px, calc(100vw - 48px)); max-height: 80vh; display: flex; flex-direction: column;"
  >
    <div class="v-row flex-shrink-0" style="justify-content: space-between;">
      <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("settings.title")}</h2>
      <button class="v-btn" style="padding: 2px 10px;" onclick={onClose}>✕</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-4">
      <!-- Appearance (live in M0) -->
      <section class="mb-6">
        <h3 class="v-section-title mb-2">{t("settings.appearance")}</h3>

        <div class="v-row mb-3" style="gap: 12px;">
          <label class="v-row" style="gap: 8px; font-size: 13px;">
            {t("settings.language")}
            <select
              value={getLocale()}
              onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value === "es" ? "es" : "en")}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
        </div>

        <div class="v-row mb-3" style="gap: 12px;">
          <label class="v-row" style="gap: 8px; font-size: 13px;">
            {t("settings.theme")}
            <select
              value={getTheme()}
              onchange={(e) => setTheme((e.currentTarget as HTMLSelectElement).value as never)}
            >
              {#each THEME_NAMES as name}
                <option value={name}>{name}</option>
              {/each}
            </select>
          </label>

          <label class="v-row" style="gap: 8px; font-size: 13px;">
            {t("settings.themeMode")}
            <select
              value={getThemeMode()}
              onchange={(e) => setThemeMode((e.currentTarget as HTMLSelectElement).value as never)}
            >
              <option value="light">{t("settings.modeLight")}</option>
              <option value="dark">{t("settings.modeDark")}</option>
              <option value="follow">{t("settings.modeFollow")}</option>
            </select>
          </label>
        </div>
      </section>

      <!-- Git (live in M1): two OAuth slots, never mixed -->
      <section class="mb-6">
        <h3 class="v-section-title mb-2">{t("git.title")}</h3>

        <div class="v-card mb-3 p-3">
          <div class="v-row" style="justify-content: space-between;">
            <b style="font-size: 13px;">{t("git.updatesSlot")}</b>
            <span class="v-muted" style="font-size: 12px;">{updatesLogin && `@${updatesLogin}`}</span>
          </div>
          <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("git.updatesSlotHint")}</p>
          <div class="v-row mt-2" style="gap: 8px;">
            <input
              type="password"
              placeholder={t("git.token")}
              value={updatesToken}
              oninput={(e) => (updatesToken = (e.currentTarget as HTMLInputElement).value)}
              style="flex: 1;"
              autocomplete="off"
            />
            <button class="v-btn" onclick={() => void connect("updates")}>{t("git.connect")}</button>
          </div>
        </div>

        <div class="v-card mb-3 p-3">
          <div class="v-row" style="justify-content: space-between;">
            <b style="font-size: 13px;">{t("git.novelSlot")}</b>
            <span class="v-muted" style="font-size: 12px;">{novelLogin && `@${novelLogin}`}</span>
          </div>
          <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("git.novelSlotHint")}</p>
          <div class="v-row mt-2" style="gap: 8px;">
            <input
              type="password"
              placeholder={t("git.token")}
              value={novelToken}
              oninput={(e) => (novelToken = (e.currentTarget as HTMLInputElement).value)}
              style="flex: 1;"
              autocomplete="off"
            />
            <button class="v-btn" onclick={() => void connect("novel")}>{t("git.connect")}</button>
          </div>
          {#if novelToken.trim()}
            <div class="v-row mt-2" style="gap: 8px;">
              <input
                type="text"
                placeholder={t("git.repoName")}
                value={repoName}
                oninput={(e) => (repoName = (e.currentTarget as HTMLInputElement).value)}
                style="flex: 1;"
              />
              <button class="v-btn" disabled={repoBusy || !repoName.trim()} onclick={() => void createNovelRepo()}>
                {t("git.createRepo")}
              </button>
            </div>
            <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("git.privateDefault")}</p>
          {:else}
            <p class="v-muted m-0 mt-2" style="font-size: 12px;">{t("git.noToken")}</p>
          {/if}
        </div>

        {#if gitNotice}
          <p class="m-0" style="font-size: 12px; color: var(--accent);">{gitNotice}</p>
        {/if}
      </section>

      <!-- Placeholder sections (filled in M2–M7) -->
      {#each placeholderSections as s (s)}
        <section class="mb-4">
          <h3 class="v-section-title mb-1">{t(`settings.sections.${s}`)}</h3>
          <p class="v-muted m-0" style="font-size: 13px;">{t("settings.comingSoon")}</p>
        </section>
      {/each}
    </div>
  </div>
</div>
