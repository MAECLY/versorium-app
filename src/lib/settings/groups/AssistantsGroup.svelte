<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import { isTauri, type AgentInfo, type McpClient, type McpLogEntry } from "$lib/tauri";
  import { detectAgents } from "$lib/ai/agents";
  import { mcp } from "$lib/mcp/state.svelte";

  // Detection only: a harness manages its own login, so there is nothing here
  // to configure — only to report whether Versorium can reach it.
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

  onMount(() => {
    if (!isTauri()) return;
    void load(false);
    void mcp.load();
  });
</script>

<!-- Detection (M2): Connected / Detected / Missing -->
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

<!-- MCP (M3): stdio on this machine, read scope by default -->
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
