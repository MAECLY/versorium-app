<script lang="ts">
  import { onMount } from "svelte";
  import { t, setLocale, getLocale } from "$lib/i18n";
  import {
    THEME_NAMES,
    THEME_MODES,
    setTheme,
    setThemeMode,
    getTheme,
    getThemeMode,
  } from "$lib/themes";
  import { api, isTauri, type AgentInfo } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { detectAgents } from "$lib/ai/agents";
  import Modal from "$lib/components/Modal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const placeholderSections: string[] = ["localAi", "mcp", "updates", "typography"];

  // --- Agents (M2): harnesses keep their own login; we only detect ---
  let agents = $state<AgentInfo[]>([]);
  let checking = $state(false);

  async function load(force: boolean): Promise<void> {
    if (!isTauri() || checking) return;
    checking = true;
    try {
      agents = await detectAgents(force);
    } catch {
      agents = [];
    } finally {
      checking = false;
    }
  }

  const recheck = (): Promise<void> => load(true);

  const stateColor: Record<AgentInfo["state"], string> = {
    connected: "var(--ok)",
    detected: "var(--warn)",
    missing: "var(--text-mute)",
  };

  // --- Safety (M2): the toggle exists; routing by it arrives with Local AI ---
  let censorship = $state(false);

  async function setCensorship(on: boolean): Promise<void> {
    censorship = on;
    if (!isTauri()) return;
    try {
      await api.setSettings({ censorship: on });
    } catch (e) {
      store.error = store.codeMessagePublic(e);
    }
  }

  // --- Git section state (two OAuth slots, never mixed) ---
  let updatesToken = $state("");
  let novelToken = $state("");
  let updatesLogin = $state("");
  let novelLogin = $state("");
  let repoName = $state("");
  let repoBusy = $state(false);
  let gitNotice = $state("");

  onMount(() => {
    if (isTauri()) {
      api
        .getSettings()
        .then((s) => {
          updatesToken = s.githubUpdatesToken ?? "";
          novelToken = s.githubNovelToken ?? "";
          censorship = s.censorship;
        })
        .catch(() => {});
      void load(false);
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

<Modal label={t("settings.title")} {onClose} wide>
  <div class="v-row flex-shrink-0" style="justify-content: space-between;">
    <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("settings.title")}</h2>
    <button class="v-btn" style="padding: 2px 10px;" onclick={onClose} aria-label={t("dialog.cancel")}>✕</button>
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
            <option value="en">{t("languages.en")}</option>
            <option value="es">{t("languages.es")}</option>
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
            {#each THEME_NAMES as name (name)}
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
            {#each THEME_MODES as mode (mode)}
              <option value={mode}>
                {mode === "light" ? t("settings.modeLight") : mode === "dark" ? t("settings.modeDark") : t("settings.modeFollow")}
              </option>
            {/each}
          </select>
        </label>
      </div>
    </section>

    <!-- Agents (live in M2): Connected / Detected / Missing -->
    <section class="mb-6">
      <div class="v-row mb-2" style="justify-content: space-between;">
        <h3 class="v-section-title m-0">{t("agents.title")}</h3>
        {#if isTauri()}
          <button class="v-btn" style="padding: 2px 10px; font-size: 12px;" disabled={checking} onclick={() => void recheck()}>
            {checking ? t("agents.checking") : t("agents.recheck")}
          </button>
        {/if}
      </div>
      <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("agents.hint")}</p>

      {#if !isTauri()}
        <p class="v-muted m-0" style="font-size: 13px;">{t("agents.none")}</p>
      {:else}
        <ul class="m-0 flex list-none flex-col gap-2 p-0" aria-busy={checking}>
          {#each agents as a (a.id)}
            <li class="v-card p-3">
              <div class="v-row" style="justify-content: space-between;">
                <b style="font-size: 13px;">{a.name}</b>
                <span
                  style="padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; color: var(--accent-contrast); background: {stateColor[a.state]};"
                >
                  {t(`agents.${a.state}`)}
                </span>
              </div>
              {#if a.version}
                <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("agents.version")}: {a.version}</p>
              {/if}
              {#if a.path}
                <p
                  class="v-muted m-0 mt-1"
                  style="font-size: 11px; font-family: var(--font-mono, ui-monospace, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  title={a.path}
                >
                  {t("agents.path")}: {a.path}
                </p>
              {/if}
              {#if a.id === "ollama" && a.state === "detected"}
                <p class="m-0 mt-1" style="font-size: 12px; color: var(--warn);">{t("agents.ollamaOffline")}</p>
              {/if}
              {#if a.models && a.models.length > 0}
                <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("agents.models")}: {a.models.join(", ")}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Safety (M2): censorship toggle; routing arrives with Local AI -->
    <section class="mb-6">
      <h3 class="v-section-title mb-2">{t("safety.title")}</h3>
      <label class="v-row" style="gap: 8px; font-size: 13px;">
        <input type="checkbox" checked={censorship} onchange={(e) => void setCensorship((e.currentTarget as HTMLInputElement).checked)} />
        {t("safety.censorship")}
        <span class="v-muted" style="font-size: 12px;">— {censorship ? t("safety.on") : t("safety.off")}</span>
      </label>
      <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("safety.censorshipHint")}</p>
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

    <!-- Placeholder sections (filled in M3–M7) -->
    {#each placeholderSections as s (s)}
      <section class="mb-4">
        <h3 class="v-section-title mb-1">{t(`settings.sections.${s}`)}</h3>
        <p class="v-muted m-0" style="font-size: 13px;">{t("settings.comingSoon")}</p>
      </section>
    {/each}
  </div>
</Modal>
