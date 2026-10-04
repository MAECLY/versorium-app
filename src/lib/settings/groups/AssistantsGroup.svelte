<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { isTauri, type AgentInfo } from "$lib/tauri";
  import { detectAgents } from "$lib/ai/agents";
  import { models } from "$lib/models/state.svelte";
  import { PROSE_ASSISTANTS } from "$lib/settings/ai/picks";
  import Disclosure from "$lib/settings/Disclosure.svelte";
  import { useSettingsNav } from "$lib/settings/nav";

  /**
   * AI › Assistants: the apps Versorium can hand a rewrite to, found on this
   * computer, each with its own login, which Versorium never stores. Only the
   * three that rewrite prose: Ollama is on Models, and the GitHub CLI is used
   * by nothing. "Found", never "Connected": that word belongs to Access, where
   * it means Versorium is in an app's settings.
   */
  const nav = useSettingsNav();

  /** The last detection; kept while a new one runs. */
  let agents = $state<AgentInfo[]>([]);
  let checking = $state(false);

  let rows = $derived(
    PROSE_ASSISTANTS.map((id) => agents.find((a) => a.id === id)).filter((a): a is AgentInfo => a !== undefined),
  );
  let found = $derived(rows.filter((a) => a.state !== "missing" && a.path));
  let rewriteWith = $derived(models.view?.slots.rewrite.kind === "cli" ? models.view.slots.rewrite.id : null);

  async function load(force: boolean): Promise<void> {
    if (!isTauri() || checking) return;
    checking = true;
    try {
      agents = await detectAgents(force);
    } catch {
      // A failed scan says nothing new; the last rows stand.
    } finally {
      checking = false;
    }
  }

  onMount(() => void load(false));
</script>

{#if !isTauri()}
  <p class="v-muted m-0" style="font-size: 13px;">{t("settings.common.desktopOnly")}</p>
{:else}
  <section class="mb-3" aria-labelledby="assistants-list-title">
    <div class="v-row mb-2" style="justify-content: space-between;">
      <h3 id="assistants-list-title" class="v-h3 m-0">{t("settings.assistants.list")}</h3>
      <button class="v-btn" style="padding: 2px 10px; font-size: 12px;" disabled={checking} onclick={() => void load(true)}>
        {checking ? t("settings.common.checking") : t("settings.common.checkAgain")}
      </button>
    </div>
    <ul class="v-boxed" aria-busy={checking}>
      {#each rows as agent (agent.id)}
        {@const isFound = agent.state !== "missing"}
        <li class="v-row" style="gap: 10px; flex-wrap: wrap; font-size: 13px;">
          <b style="min-width: 110px;">{agent.name}</b>
          <span class="v-row" style="gap: 6px;">
            <span class="v-status-dot" data-tone={isFound ? "ok" : "mute"} aria-hidden="true"></span>
            <span class={isFound ? "" : "v-muted"}>
              {isFound
                ? agent.version
                  ? t("settings.assistants.found", { version: agent.version })
                  : t("settings.assistants.foundNoVersion")
                : t("settings.assistants.notFound")}
            </span>
          </span>
          {#if rewriteWith === agent.id}
            <span aria-hidden="true">·</span>
            <button class="v-link" onclick={() => nav.navigate({ page: "tasks", focus: "rewrite" })}>
              {t("settings.assistants.usedForRewrite")}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <p class="m-0 mb-3" style="font-size: 12.5px; line-height: 1.6;">{t("settings.assistants.scope")}</p>

  {#if found.length > 0}
    <div class="mb-3">
      <Disclosure key="assistants:where" label={t("settings.assistants.where")}>
        <ul class="m-0 flex list-none flex-col gap-1 p-0" style="font-size: 12px;">
          {#each found as agent (agent.id)}
            <li><span class="v-muted">{agent.name}:</span> <span class="v-mono-select">{agent.path}</span></li>
          {/each}
        </ul>
      </Disclosure>
    </div>
  {/if}

  <p class="m-0" style="font-size: 12.5px; line-height: 1.9;">
    <button class="v-link" onclick={() => nav.navigate({ page: "tasks", focus: "rewrite" })}>
      {t("settings.assistants.chooseInTasks")}
    </button>
    <br />
    <button class="v-link" onclick={() => nav.navigate({ page: "access" })}>{t("settings.assistants.seeAccess")}</button>
  </p>
{/if}
