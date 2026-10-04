<script lang="ts">
  import { tick, untrack } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import type { McpClient, McpLogEntry } from "$lib/tauri";
  import { mcp } from "$lib/mcp/state.svelte";
  import { actionLabel, outcomeLabel } from "$lib/mcp/activity";
  import { notices } from "$lib/notices/state.svelte";
  import { restoreFocus } from "$lib/components/restoreFocus";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import ExpanderRow from "$lib/settings/ExpanderRow.svelte";
  import { disclosures } from "$lib/settings/disclosures.svelte";
  import { useSettingsNav } from "$lib/settings/nav";

  /**
   * One app that can open the novel through Versorium. "Connected" means one
   * thing only: Versorium is in that app's settings. Reading is all it can do
   * until the writer lets it write, through a dialog that says what that
   * means, and only once it is connected (Rust refuses otherwise).
   */
  let { client, recent }: { client: McpClient; recent: McpLogEntry[] } = $props();

  const nav = useSettingsNav();
  // A row stays with its app: the key is read once, as the row is drawn.
  const key = untrack(() => `access:${client.id}`);
  let open = $state(disclosures.isOpen(key));
  $effect(() => disclosures.set(key, open));

  let name = $derived(t(`mcp.clients.${client.id}`));
  let confirming = $state(false);
  let refused = $state<string | null>(null);
  let restart = $state(false);

  let status = $derived(
    client.installed
      ? client.writeAllowed
        ? t("settings.access.status.canWrite")
        : t("settings.access.status.readOnly")
      : client.writeAllowed
        ? t("settings.access.status.staleWrite")
        : client.detected
          ? t("settings.access.status.notSetUp")
          : t("settings.access.status.notFound"),
  );
  let tone = $derived<"ok" | "warn" | "mute">(
    client.writeAllowed ? "warn" : client.installed ? "ok" : "mute",
  );

  function time(ts: number): string {
    const date = new Date(ts);
    const today = new Date().toDateString() === date.toDateString();
    return today
      ? date.toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" })
      : date.toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  /** The control that now stands where the pressed one was. */
  async function land(selector: string): Promise<void> {
    await tick();
    const row = document.getElementById(`access-${client.id}-panel`)?.closest(".v-expander");
    restoreFocus(row?.querySelector(selector));
  }

  async function connect(): Promise<void> {
    restart = false;
    await mcp.install(client.id);
    if (mcp.error) return;
    // Opened, so the restart it needs and what it may do now are in view;
    // the Connect pressed is gone, so focus goes to the row's header.
    restart = true;
    open = true;
    await land(".v-expander-toggle");
  }

  async function disconnect(): Promise<void> {
    restart = false;
    await mcp.uninstall(client.id);
    if (mcp.error) return;
    restart = true;
    await land("[data-connect]");
  }

  async function grant(): Promise<void> {
    refused = null;
    await mcp.setWrite(client.id, true);
    confirming = false;
    if (mcp.error) {
      // Refused by Rust (it was disconnected meanwhile): nothing changed.
      // Said here, where it was asked, and not again at the top of the page.
      refused = mcp.takeError();
      await land("[data-allow]");
      return;
    }
    notices.inform(t("settings.access.grantedAnnounce", { client: name }), "settings.access.write");
    await land("[data-revoke]");
  }

  async function revoke(): Promise<void> {
    refused = null;
    await mcp.setWrite(client.id, false);
    if (mcp.error) return;
    notices.inform(t("settings.access.revokedAnnounce", { client: name }), "settings.access.write");
    await land(client.installed ? "[data-allow]" : ".v-expander-toggle");
  }
</script>

<ExpanderRow id="access-{client.id}" focusKey="access:{client.id}" title={name} {status} {tone} bind:open>
    {#snippet actions()}
      {#if !client.installed}
        <button class="v-btn" data-connect disabled={mcp.loading} onclick={() => void connect()}>
          {client.detected ? t("mcp.connect") : t("settings.access.connectAnyway")}
        </button>
      {/if}
    {/snippet}

    <!-- What it may do, and the one control that changes it. -->
    {#if client.writeAllowed}
      <p class="m-0" style="font-size: 12.5px; line-height: 1.6; color: var(--warn);">
        {t("settings.access.canWriteText", { client: name })}
      </p>
      <button class="v-btn mt-2" data-revoke disabled={mcp.loading} onclick={() => void revoke()}>
        {t("settings.access.makeReadOnly")}
      </button>
    {:else}
      <p class="m-0" style="font-size: 12.5px; line-height: 1.6;">{t("settings.access.readOnlyText")}</p>
      <div class="v-row mt-2" style="gap: 10px; flex-wrap: wrap;">
        <button
          class="v-btn"
          data-allow
          disabled={!client.installed || mcp.loading}
          aria-describedby={client.installed ? undefined : `access-${client.id}-first`}
          onclick={() => {
            refused = null;
            confirming = true;
          }}
        >
          {t("settings.access.allowWriting")}
        </button>
        {#if !client.installed}
          <span id="access-{client.id}-first" class="v-muted" style="font-size: 12px;">
            {t("settings.access.connectFirst", { client: name })}
          </span>
        {/if}
      </div>
    {/if}
    {#if refused}
      <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{refused}</p>
    {/if}

    <h4 class="v-h4 mb-1 mt-4">{t("settings.access.recent")}</h4>
    {#if recent.length === 0}
      <p class="v-muted m-0" style="font-size: 12.5px;">{t("settings.access.recentEmpty")}</p>
    {:else}
      <ul class="m-0 flex list-none flex-col gap-1 p-0" style="font-size: 12.5px;">
        {#each recent as entry, index (`${entry.ts}-${index}`)}
          <li>
            <span class="v-muted" style="font-variant-numeric: tabular-nums;">{time(entry.ts)}</span>
            · {actionLabel(entry.tool)} · {outcomeLabel(entry)}
          </li>
        {/each}
      </ul>
    {/if}
    <p class="m-0 mt-1" style="font-size: 12.5px;">
      <button class="v-link" onclick={() => nav.navigate({ page: "activity", client: client.id })}>
        {t("settings.access.allActivity")}
      </button>
    </p>

    <!-- By hand: inline text, never a disclosure inside a disclosure. -->
    <div class="v-muted mt-4" style="font-size: 12px; line-height: 1.6;">
      <p class="m-0">{t("settings.access.byHandCommand", { client: name })}</p>
      <p class="m-0"><span class="v-mono-select">{mcp.status?.command} {mcp.status?.args.join(" ")} --client {client.id}</span></p>
      <p class="m-0 mt-1">{t("settings.access.byHandFile")} <span class="v-mono-select">{client.configPath}</span></p>
    </div>

    {#if client.installed}
      <div class="v-row mt-3 pt-3" style="gap: 10px; flex-wrap: wrap; border-top: 1px solid var(--border);">
        <button class="v-btn" disabled={mcp.loading} onclick={() => void disconnect()}>{t("mcp.disconnect")}</button>
        <span class="v-muted" style="font-size: 12px;">{t("settings.access.disconnectHint", { client: name })}</span>
      </div>
    {/if}

    <!-- Always here, so the words are read when they arrive. -->
    <p class="m-0 mt-2" style="font-size: 12px; color: var(--accent);" aria-live="polite">
      {restart ? t("mcp.restartHint", { client: name }) : ""}
    </p>
</ExpanderRow>

{#if confirming}
  <ConfirmDialog
    title={t("settings.access.dialog.title", { client: name })}
    body={[
      t("mcp.writeWarning"),
      t("settings.access.dialog.what", { client: name }),
      t("settings.access.dialog.snapshot"),
      t("settings.access.dialog.review"),
    ]}
    cancelLabel={t("settings.access.dialog.cancel")}
    confirmLabel={t("settings.access.dialog.confirm", { client: name })}
    tone="neutral"
    alert
    onCancel={() => (confirming = false)}
    onConfirm={grant}
  />
{/if}
