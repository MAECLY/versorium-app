<script lang="ts">
  import { untrack } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import { isTauri, type McpLogEntry } from "$lib/tauri";
  import { mcp } from "$lib/mcp/state.svelte";
  import {
    actionLabel,
    clientLabel,
    CLIENTS,
    matches,
    outcomeLabel,
    outcomeOf,
    type Filters,
    type Kind,
    type ResultFilter,
  } from "$lib/mcp/activity";
  import Select from "$lib/components/forms/Select.svelte";
  import { useSettingsNav } from "$lib/settings/nav";

  /**
   * Other apps › Activity: what outside apps asked Versorium to do, newest
   * first, in words. The technical line under each is the log as written:
   * tool names, paths and counts, never the writer's text. No row claims a
   * snapshot was saved: the log does not know, and a preview makes none.
   */
  let { client }: { client?: string } = $props();

  const nav = useSettingsNav();
  const PAGE = 100;

  // Opened from an app's "All activity ›": that app, preset.
  let filters = $state<Filters>({ app: untrack(() => client) ?? "all", kind: "all", result: "all" });
  let limit = $state(PAGE);

  let entries = $derived(mcp.log.filter((entry) => matches(entry, filters)));
  let visible = $derived(entries.slice(0, limit));

  let apps = $derived([
    { value: "all", label: t("settings.activity.filter.allApps") },
    ...CLIENTS.map((id) => ({ value: id, label: clientLabel(id) })),
    ...(mcp.log.some((entry) => entry.client === "unknown")
      ? [{ value: "unknown", label: t("settings.activity.unknownClient") }]
      : []),
  ]);

  const KINDS: Kind[] = ["all", "read", "write"];
  const KIND_LABEL: Record<Kind, string> = { all: "kind.all", read: "kind.reading", write: "kind.changes" };
  const RESULTS: ResultFilter[] = ["all", "done", "preview", "refused", "failed"];
  const RESULT_LABEL: Record<ResultFilter, string> = {
    all: "result.all",
    done: "result.done",
    preview: "result.preview",
    refused: "result.refused",
    failed: "result.failed",
  };

  function setFilter(next: Partial<Filters>): void {
    filters = { ...filters, ...next };
    limit = PAGE;
  }

  function time(ts: number): string {
    const date = new Date(ts);
    const today = new Date().toDateString() === date.toDateString();
    return today
      ? date.toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" })
      : date.toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function tone(entry: McpLogEntry): string {
    const outcome = outcomeOf(entry);
    return outcome === "refused" || outcome === "failed" ? "color: var(--warn);" : "";
  }
</script>

{#if !isTauri()}
  <p class="v-muted m-0" style="font-size: 13px;">{t("settings.common.desktopOnly")}</p>
{:else}
  <div class="v-row mb-3" style="gap: 12px; align-items: flex-end; flex-wrap: wrap;">
    <Select
      label={t("settings.activity.filter.app")}
      value={filters.app}
      options={apps}
      onChange={(app) => setFilter({ app })}
    />
    <Select
      label={t("settings.activity.filter.kind")}
      value={filters.kind}
      options={KINDS.map((kind) => ({ value: kind, label: t(`settings.activity.${KIND_LABEL[kind]}`) }))}
      onChange={(kind) => setFilter({ kind })}
    />
    <Select
      label={t("settings.activity.filter.result")}
      value={filters.result}
      options={RESULTS.map((result) => ({ value: result, label: t(`settings.activity.${RESULT_LABEL[result]}`) }))}
      onChange={(result) => setFilter({ result })}
    />
    <button class="v-btn" disabled={mcp.loading} onclick={() => void mcp.refreshLog()}>
      {mcp.loading ? t("settings.common.checking") : t("settings.common.checkAgain")}
    </button>
    <p class="v-muted m-0" style="font-size: 12px; margin-left: auto;" aria-live="polite">
      {t("settings.activity.showing", { shown: Math.min(limit, entries.length), total: entries.length })}
    </p>
  </div>

  {#if mcp.error}
    <p role="alert" class="m-0 mb-3" style="font-size: 12.5px; color: var(--warn);">{mcp.error}</p>
  {/if}

  {#if mcp.log.length === 0}
    <p class="v-muted m-0" style="font-size: 13px;">{t("settings.activity.empty")}</p>
  {:else if entries.length === 0}
    <p class="v-muted m-0" style="font-size: 13px;">{t("settings.activity.noMatch")}</p>
  {:else}
    <ul class="v-boxed" aria-busy={mcp.loading}>
      {#each visible as entry, index (`${entry.ts}-${entry.client}-${index}`)}
        <li class="v-activity-row">
          <span class="v-muted" style="font-size: 12px; font-variant-numeric: tabular-nums;">{time(entry.ts)}</span>
          <div style="min-width: 0;">
            <p class="m-0" style="font-size: 13px;">
              <b>{clientLabel(entry.client)}</b> · {actionLabel(entry.tool)}
            </p>
            <p class="m-0 mt-1" style="font-size: 12.5px; {tone(entry)}">
              {outcomeLabel(entry)}
              {#if outcomeOf(entry) === "refused" && (CLIENTS as readonly string[]).includes(entry.client)}
                ·
                <button
                  class="v-link"
                  onclick={() => nav.navigate({ page: "access", client: entry.client as (typeof CLIENTS)[number] })}
                >
                  {t("settings.activity.changeAccess")}
                </button>
              {/if}
            </p>
            <p class="v-muted m-0 mt-1"><span class="v-mono-select">{entry.tool}{entry.detail ? ` · ${entry.detail}` : ""}</span></p>
          </div>
        </li>
      {/each}
    </ul>
    {#if entries.length > limit}
      <button class="v-btn mt-3" onclick={() => (limit += PAGE)}>{t("settings.activity.showMore")}</button>
    {/if}
  {/if}
{/if}
