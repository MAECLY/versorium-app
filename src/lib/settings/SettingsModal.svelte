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
  import {
    api,
    isTauri,
    type AgentInfo,
    type ContinuityReport,
    type McpClient,
    type McpLogEntry,
  } from "$lib/tauri";
  import { errorMessage, warningMessage } from "$lib/i18n/errors";
  import { store } from "$lib/binder/store.svelte";
  import { updates } from "$lib/update/state.svelte";
  import { detectAgents } from "$lib/ai/agents";
  import { mcp } from "$lib/mcp/state.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import LocalAiSection from "$lib/settings/LocalAiSection.svelte";
  import UpdatesSection from "$lib/settings/UpdatesSection.svelte";
  import TypographySection from "$lib/settings/TypographySection.svelte";
  import SafetySectionCrash from "$lib/settings/SafetySectionCrash.svelte";

  let { onClose }: { onClose: () => void } = $props();

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

  // --- Continuity (M7): a stub; it only runs when a local model is selected ---
  let continuityReport = $state<ContinuityReport | null>(null);
  let continuityBusy = $state(false);
  let continuityError = $state<string | null>(null);

  async function runContinuity(): Promise<void> {
    const path = store.project?.path;
    if (!path || continuityBusy) return;
    continuityBusy = true;
    continuityError = null;
    try {
      continuityReport = await api.continuityCheck(path);
    } catch (e) {
      continuityError = errorMessage(e);
    } finally {
      continuityBusy = false;
    }
  }

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

  // --- MCP (M3): local stdio server, read-only until allowed per client ---
  let mcpNotice = $state<{ id: string; text: string } | null>(null);

  async function toggleClient(client: McpClient): Promise<void> {
    mcpNotice = null;
    const wasInstalled = client.installed;
    await (wasInstalled ? mcp.uninstall(client.id) : mcp.install(client.id));
    // A client only re-reads its config on start, so say so once it worked.
    if (!mcp.error) mcpNotice = { id: client.id, text: t("mcp.restartHint", { client: client.name }) };
  }

  function logTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(getLocale());
  }

  const outcomeColor: Record<McpLogEntry["outcome"], string> = {
    ok: "var(--ok)",
    denied: "var(--warn)",
    error: "var(--warn)",
  };

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
      void mcp.load();
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
      // The Updates panel decides whether it may check from this token, and it
      // lives in another section — without this it keeps saying "signed out"
      // until Settings is reopened.
      if (slot === "updates") await updates.load();
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
    <section class="mb-6" aria-label={t("settings.appearance")}>
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
    <section class="mb-6" aria-label={t("agents.title")}>
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

    <!-- Local AI (live in M4): built-in GGUF ladder, Ollama, Studio, slots -->
    <LocalAiSection />

    <!-- Continuity (M7): a stub that only runs when a local model is selected -->
    <section class="mb-6" aria-label={t("continuity.title")}>
      <div class="v-row mb-2" style="justify-content: space-between;">
        <h3 class="v-section-title m-0">{t("continuity.title")}</h3>
        {#if isTauri()}
          <button
            class="v-btn"
            style="padding: 2px 10px; font-size: 12px;"
            disabled={continuityBusy || !store.project}
            onclick={() => void runContinuity()}
          >
            {continuityBusy ? t("continuity.running") : t("continuity.run")}
          </button>
        {/if}
      </div>
      <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("continuity.hint")}</p>

      {#if !isTauri()}
        <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.none")}</p>
      {:else if !store.project}
        <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.noProject")}</p>
      {:else if continuityReport}
        {#if !continuityReport.ran}
          <p class="m-0" style="font-size: 12.5px; color: var(--warn);">
            {warningMessage(continuityReport.reason ?? "continuity_failed")}
          </p>
        {:else if continuityReport.findings.length === 0}
          <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.clean")}</p>
        {:else}
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            {#each continuityReport.findings as finding, index (index)}
              <li class="v-card p-2" style="font-size: 12.5px;">
                <b>{finding.kind}</b>
                {#if finding.chapter}
                  <span class="v-muted" style="font-size: 11px;"> — {finding.chapter}</span>
                {/if}
                <p class="m-0 mt-1">{finding.detail}</p>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      {#if continuityError}
        <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">
          {continuityError}
        </p>
      {/if}
    </section>

    <!-- Safety (M2): censorship toggle; routing arrives with Local AI -->
    <section class="mb-6" aria-label={t("safety.title")}>
      <h3 class="v-section-title mb-2">{t("safety.title")}</h3>
      <label class="v-row" style="gap: 8px; font-size: 13px;">
        <input type="checkbox" checked={censorship} onchange={(e) => void setCensorship((e.currentTarget as HTMLInputElement).checked)} />
        {t("safety.censorship")}
        <span class="v-muted" style="font-size: 12px;">— {censorship ? t("safety.on") : t("safety.off")}</span>
      </label>
      <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("safety.censorshipHint")}</p>
    </section>

    <!-- MCP (live in M3): stdio on this machine, read scope by default -->
    <section class="mb-6" aria-label={t("mcp.title")}>
      <div class="v-row mb-2" style="justify-content: space-between;">
        <h3 class="v-section-title m-0">{t("mcp.title")}</h3>
        {#if isTauri()}
          <button
            class="v-btn"
            style="padding: 2px 10px; font-size: 12px;"
            disabled={mcp.loading}
            onclick={() => void mcp.load()}
          >
            {t("mcp.refresh")}
          </button>
        {/if}
      </div>
      <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("mcp.intro")}</p>

      {#if !isTauri()}
        <p class="v-muted m-0" style="font-size: 13px;">{t("mcp.none")}</p>
      {:else}
        {#if mcp.error}
          <p role="alert" class="m-0 mb-3" style="font-size: 12px; color: var(--warn);">{mcp.error}</p>
        {/if}

        {#if mcp.status}
          <div class="v-card mb-3 p-3">
            <b style="font-size: 13px;">{t("mcp.command")}</b>
            <p
              class="m-0 mt-1"
              style="font-size: 11.5px; font-family: var(--font-mono, ui-monospace, monospace); overflow-x: auto; white-space: nowrap;"
            >
              {mcp.status.command} {mcp.status.args.join(" ")}
            </p>
            <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("mcp.commandHint")}</p>
          </div>

          <p class="m-0 mb-2" style="font-size: 12px; color: var(--warn);">{t("mcp.writeWarning")}</p>

          <ul class="m-0 mb-3 flex list-none flex-col gap-2 p-0" aria-busy={mcp.loading}>
            {#each mcp.clients as c (c.id)}
              <li class="v-card p-3">
                <div class="v-row" style="justify-content: space-between; gap: 8px;">
                  <b style="font-size: 13px;">{t(`mcp.clients.${c.id}`)}</b>
                  <span
                    style="padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; color: var(--accent-contrast); background: {c.installed ? 'var(--ok)' : 'var(--text-mute)'};"
                  >
                    {c.installed ? t("mcp.connected") : t("mcp.notConnected")}
                  </span>
                </div>

                <p class="v-muted m-0 mt-1" style="font-size: 12px;">
                  {c.detected ? t("mcp.detected") : t("mcp.notDetected")}
                </p>
                <p
                  class="v-muted m-0 mt-1"
                  style="font-size: 11px; font-family: var(--font-mono, ui-monospace, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  title={c.configPath}
                >
                  {t("mcp.configPath")}: {c.configPath}
                </p>

                <div class="v-row mt-2" style="gap: 12px; flex-wrap: wrap;">
                  <button class="v-btn" disabled={mcp.loading} onclick={() => void toggleClient(c)}>
                    {c.installed ? t("mcp.disconnect") : t("mcp.connect")}
                  </button>
                  <label class="v-row" style="gap: 8px; font-size: 13px;">
                    <input
                      type="checkbox"
                      checked={c.writeAllowed}
                      disabled={mcp.loading}
                      onchange={(e) => void mcp.setWrite(c.id, (e.currentTarget as HTMLInputElement).checked)}
                    />
                    {t("mcp.allowWrite")}
                    <span class="v-muted" style="font-size: 12px;">
                      — {c.writeAllowed ? t("mcp.scopeWrite") : t("mcp.readOnly")}
                    </span>
                  </label>
                </div>

                {#if mcpNotice && mcpNotice.id === c.id}
                  <p class="m-0 mt-1" aria-live="polite" style="font-size: 12px; color: var(--accent);">
                    {mcpNotice.text}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        <div class="v-row mb-1" style="justify-content: space-between;">
          <b style="font-size: 13px;">{t("mcp.log")}</b>
          <button
            class="v-btn"
            style="padding: 2px 10px; font-size: 12px;"
            disabled={mcp.loading}
            onclick={() => void mcp.refreshLog()}
          >
            {t("mcp.refresh")}
          </button>
        </div>
        <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("mcp.logHint")}</p>

        {#if mcp.log.length === 0}
          <p class="v-muted m-0" style="font-size: 13px;">{t("mcp.logEmpty")}</p>
        {:else}
          <ul class="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("mcp.log")} aria-busy={mcp.loading}>
            {#each mcp.log as e, i (`${e.ts}-${i}`)}
              <li class="v-row" style="gap: 8px; font-size: 12px;">
                <span class="v-muted" style="font-variant-numeric: tabular-nums;">{logTime(e.ts)}</span>
                <span>{e.client}</span>
                <span style="font-family: var(--font-mono, ui-monospace, monospace);">{e.tool}</span>
                <span class="v-muted">{e.scope === "write" ? t("mcp.scopeWrite") : t("mcp.scopeRead")}</span>
                <span style="font-weight: 600; color: {outcomeColor[e.outcome]};">
                  {e.outcome === "ok" ? t("mcp.outcomeOk") : e.outcome === "denied" ? t("mcp.outcomeDenied") : t("mcp.outcomeError")}
                </span>
                {#if e.detail}
                  <span
                    class="v-muted"
                    style="flex: 1; min-width: 0; font-family: var(--font-mono, ui-monospace, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                    title={e.detail}
                  >
                    {e.detail}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>

    <!-- Git (live in M1): two OAuth slots, never mixed -->
    <section class="mb-6" aria-label={t("git.title")}>
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

    <UpdatesSection />

    <TypographySection />

    <SafetySectionCrash />
  </div>
</Modal>
