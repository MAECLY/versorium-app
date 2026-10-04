<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import { api, isTauri, type McpHttpStatus } from "$lib/tauri";
  import { errorMessage } from "$lib/i18n/errors";
  import { mcp } from "$lib/mcp/state.svelte";
  import { writers } from "$lib/mcp/activity";
  import { notices } from "$lib/notices/state.svelte";
  import Checkbox from "$lib/components/forms/Checkbox.svelte";
  import { restoreFocus } from "$lib/components/restoreFocus";
  import Disclosure from "$lib/settings/Disclosure.svelte";
  import ClientRow from "$lib/settings/access/ClientRow.svelte";
  import { disclosures } from "$lib/settings/disclosures.svelte";
  import { useSettingsNav } from "$lib/settings/nav";

  /**
   * Other apps › Access to your novel: the apps that can open the novel
   * through Versorium (MCP), and how much each may do. Read only until the
   * writer lets one write. The warning colour appears only where writing is
   * actually on; the safe path is never weaker-looking than the grant.
   */
  let { client }: { client?: string } = $props();

  const nav = useSettingsNav();

  // A link here for one app ("Change access ›") opens its row before it
  // draws; SettingsPage then puts focus on the row's header.
  untrack(() => {
    if (client) disclosures.set(`access:${client}`, true);
  });

  let clients = $derived(mcp.clients);
  let shown = $derived(clients.filter((c) => c.detected || c.installed || c.writeAllowed));
  let hidden = $derived(clients.filter((c) => !(c.detected || c.installed || c.writeAllowed)));
  let granted = $derived(writers(clients));
  let summaryLine = $state<HTMLParagraphElement>();

  let summary = $derived.by(() => {
    if (granted.length === 0) return t("settings.access.summary.none");
    const names = new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(
      granted.map((c) => t(`mcp.clients.${c.id}`)),
    );
    return granted.length === 1
      ? t("settings.access.summary.one", { names })
      : t("settings.access.summary.other", { count: granted.length, names });
  });

  function recentFor(id: string) {
    return mcp.log.filter((entry) => entry.client === id).slice(0, 5);
  }

  async function makeAllReadOnly(): Promise<void> {
    await mcp.makeAllReadOnly();
    if (mcp.error) return;
    notices.inform(t("settings.access.allReadOnlyDone"), "settings.access.write");
    // The button went with the warning; focus goes to the line that says so.
    await tick();
    restoreFocus(summaryLine);
  }

  // MCP over HTTP, for apps that cannot start a program. Off by default:
  // it opens a listener on a computer whose tools can write to a manuscript.
  let http = $state<McpHttpStatus | null>(null);
  let httpError = $state<string | null>(null);

  async function setHttp(enabled: boolean): Promise<void> {
    httpError = null;
    try {
      http = await api.mcpSetHttp(enabled);
    } catch (e) {
      httpError = errorMessage(e);
    }
  }

  onMount(() => {
    if (!isTauri()) return;
    api
      .mcpHttpStatus()
      .then((status) => (http = status))
      .catch(() => (http = null));
  });
</script>

{#if !isTauri()}
  <p class="v-muted m-0" style="font-size: 13px;">{t("settings.common.desktopOnly")}</p>
{:else}
  <div class="v-row mb-4" style="gap: 12px; flex-wrap: wrap;">
    <p
      bind:this={summaryLine}
      tabindex="-1"
      class="m-0"
      style="font-size: 13px; line-height: 1.6; outline: none; {granted.length > 0 ? 'color: var(--warn);' : ''}"
    >
      {summary}
    </p>
    {#if granted.length > 0}
      <button class="v-btn" disabled={mcp.loading} onclick={() => void makeAllReadOnly()}>
        {t("settings.access.makeAllReadOnly")}
      </button>
    {/if}
  </div>

  {#if mcp.error}
    <p role="alert" class="m-0 mb-3" style="font-size: 12.5px; color: var(--warn);">{mcp.error}</p>
  {/if}

  <section class="mb-4" aria-labelledby="access-list-title">
    <div class="v-row mb-2" style="justify-content: space-between;">
      <h3 id="access-list-title" class="v-h3 m-0">{t("settings.access.list")}</h3>
      <button class="v-btn" style="padding: 2px 10px; font-size: 12px;" disabled={mcp.loading} onclick={() => void mcp.load()}>
        {mcp.loading ? t("settings.common.checking") : t("settings.common.checkAgain")}
      </button>
    </div>
    {#if shown.length > 0}
      <div class="v-card" aria-busy={mcp.loading}>
        {#each shown as c (c.id)}
          <ClientRow client={c} recent={recentFor(c.id)} />
        {/each}
      </div>
    {:else if mcp.status}
      <p class="v-muted m-0" style="font-size: 12.5px;">{t("settings.access.noneFound")}</p>
    {/if}
  </section>

  {#if hidden.length > 0}
    <div class="mb-4">
      <Disclosure
        key="access:notFound"
        label={t("settings.access.notFoundTitle", { count: hidden.length })}
        initiallyOpen={shown.length === 0}
      >
        <p class="v-muted m-0 mb-2" style="font-size: 12px; line-height: 1.6;">{t("settings.access.notFoundHint")}</p>
        <div class="v-card">
          {#each hidden as c (c.id)}
            <ClientRow client={c} recent={recentFor(c.id)} />
          {/each}
        </div>
      </Disclosure>
    </div>
  {/if}

  <div class="mb-4">
    <Disclosure key="access:advanced" label={t("settings.access.advanced")}>
      <div style="font-size: 12.5px; line-height: 1.6;">
        <Checkbox
          label={t("mcp.httpTitle")}
          hint={t("mcp.httpHint")}
          checked={http?.enabled ?? false}
          onChange={(next) => void setHttp(next)}
        />
        <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("settings.access.httpReadOnly")}</p>
        {#if http?.enabled}
          {#if http.url}
            <p class="m-0 mt-2" style="font-size: 12px;">
              {t("mcp.httpUrl")}: <span class="v-mono-select">{http.url}</span>
            </p>
          {/if}
          {#if http.endpointFile}
            <p class="v-muted m-0 mt-1" style="font-size: 12px;">
              {t("mcp.httpFile")}: <span class="v-mono-select">{http.endpointFile}</span>
            </p>
          {/if}
          <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("mcp.httpRestart")}</p>
        {:else}
          <p class="v-muted m-0 mt-2" style="font-size: 12px;">{t("settings.access.httpOff")}</p>
        {/if}
        {#if httpError}
          <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{httpError}</p>
        {/if}

        {#if mcp.status}
          <p class="m-0 mt-3" style="font-size: 12px;">
            {t("settings.access.command")}
            <span class="v-mono-select">{mcp.status.command} {mcp.status.args.join(" ")}</span>
          </p>
        {/if}
        <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("settings.access.network")}</p>
      </div>
    </Disclosure>
  </div>

  <p class="m-0" style="font-size: 12.5px; line-height: 1.9;">
    <button class="v-link" onclick={() => nav.navigate({ page: "activity" })}>{t("settings.access.seeActivity")}</button>
    <br />
    <button class="v-link" onclick={() => nav.navigate({ page: "assistants" })}>{t("settings.access.seeAssistants")}</button>
  </p>
{/if}
