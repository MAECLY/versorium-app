<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { t } from "$lib/i18n";
  import { isTauri, type AgentInfo } from "$lib/tauri";
  import { detectAgents } from "$lib/ai/agents";
  import { chrome } from "$lib/chrome/state.svelte";
  import { notices } from "$lib/notices/state.svelte";
  import { models } from "$lib/models/state.svelte";
  import { engine } from "$lib/models/engine.svelte";
  import GpuNotice from "$lib/settings/models/GpuNotice.svelte";
  import Select from "$lib/components/forms/Select.svelte";
  import { useSettingsNav } from "$lib/settings/nav";
  import {
    foundAssistants,
    parseValue,
    slotValue,
    taskOptions,
    taskStatus,
    taskSummary,
    TASKS,
    type Candidate,
    type TaskSlot,
  } from "$lib/settings/ai/picks";

  /**
   * AI › Tasks: what AI can do here, and which model does it.
   *
   * A native select per task, grouped by where the passage goes, with a line
   * under it that says so. A radio list would save a choice on every arrow
   * key, and send the next passage somewhere the writer only walked past. The
   * line is the select's description, and the settled choice is read once,
   * 400 ms after the last change: on Windows a closed select changes on each
   * arrow key. Nothing is sent anywhere until a rewrite runs.
   */

  const nav = useSettingsNav();

  /** The assistants detection found; null until it answered. */
  let agents = $state<AgentInfo[] | null>(null);
  let view = $derived(models.view);
  let summary = $derived(view && agents ? taskSummary(view, agents) : null);
  let assistantsFound = $derived(agents !== null && foundAssistants(agents).length > 0);
  let selects = $state<Partial<Record<TaskSlot, HTMLSelectElement>>>({});

  /** A task uses a model in Versorium, or the summary is about to offer one, and the engine failed. */
  let engineNotice = $derived.by(() => {
    if (!engine.failed || !view) return false;
    const builtin = TASKS.some((slot) => view.slots[slot].kind === "builtin");
    const offered = summary?.button && "candidate" in summary.button && summary.button.candidate.kind === "builtin";
    return builtin || Boolean(offered);
  });

  onMount(() => {
    if (!isTauri()) return;
    void engine.poll();
    detectAgents()
      .then((list) => (agents = list))
      .catch(() => (agents = []));
  });

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(settleTimer));

  /** Read the new status line once the choice has stopped moving. */
  function announceSettled(slot: TaskSlot): void {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const current = models.view;
      if (!current || !agents) return;
      void chrome.announce(taskStatus(slot, current.slots[slot], current, agents).text);
    }, 400);
  }

  async function choose(slot: TaskSlot, value: string): Promise<void> {
    const { kind, id } = parseValue(value);
    // The disabled "not answering" line is never a choice, and never stored.
    if (kind === "server" && id === "") return;
    announceSettled(slot);
    await models.setSlot(slot, kind, id);
    if (!models.error) return;
    // Refused: the select shows what is stored, not what was asked for; the
    // alert above the summary says why.
    clearTimeout(settleTimer);
    const select = selects[slot];
    if (select && models.view) select.value = slotValue(models.view.slots[slot]);
  }

  /** One click: the candidate for both tasks, or for Continuity, one after the other. */
  async function useCandidate(candidate: Candidate, both: boolean): Promise<void> {
    if (both) await models.setSlot("rewrite", candidate.kind, candidate.id);
    if (models.error) return;
    await models.setSlot("continuity", candidate.kind, candidate.id);
    if (models.error) return;
    notices.inform(
      t(both ? "settings.tasks.announce.both" : "settings.tasks.announce.continuity", { model: candidate.label }),
      "settings.tasks.oneClick",
    );
    // The button goes with the summary that held it; focus goes to the task
    // that changed instead of to nowhere.
    await tick();
    selects[both ? "rewrite" : "continuity"]?.focus();
  }
</script>

{#if !isTauri()}
  <p class="v-muted m-0" style="font-size: 13px;">{t("settings.common.desktopOnly")}</p>
{:else}
  <GpuNotice />
  {#if engineNotice}
    <p class="m-0 mb-3" style="font-size: 12.5px; line-height: 1.6; color: var(--warn);">
      {t("settings.common.engineDown")}
      <button class="v-link" onclick={() => nav.navigate({ page: "models" })}>{t("settings.common.toModels")}</button>
    </p>
  {/if}

  {#if models.error}
    <p role="alert" class="m-0 mb-3" style="font-size: 12.5px; color: var(--warn);">{models.error}</p>
  {/if}

  <!-- Not a live region: what a press here changes is said through the
       notices, and the selects' own lines say the rest. -->
  {#if summary}
    <div class="v-card mb-4 p-3" data-testid="tasks-summary">
      {#each summary.sentences as line, index (index)}
        <p class="m-0" style="font-size: 13px; line-height: 1.6; {line.warn ? 'color: var(--warn);' : ''}">
          {line.text}
        </p>
      {/each}
      {#if summary.button}
        {@const button = summary.button}
        <div class="v-row mt-3" style="gap: 10px; flex-wrap: wrap;">
          {#if button.kind === "getModel"}
            <button class="v-btn v-btn-primary" onclick={() => nav.navigate({ page: "models", focus: "start" })}>
              {t("settings.tasks.summary.getModel")}
            </button>
          {:else if button.kind === "checkAgain"}
            <button class="v-btn" disabled={models.loading} onclick={() => void models.load()}>
              {models.loading ? t("settings.common.checking") : t("settings.common.checkAgain")}
            </button>
          {:else}
            <button
              class="v-btn v-btn-primary"
              disabled={models.loading}
              onclick={() => void useCandidate(button.candidate, button.kind === "both")}
            >
              {t(button.kind === "both" ? "settings.tasks.summary.useForBoth" : "settings.tasks.summary.useForContinuity", {
                model: button.candidate.label,
              })}
            </button>
            <span class="v-muted" style="font-size: 12px;">{button.meta}</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <ul class="v-boxed mb-6">
    {#each TASKS as slot (slot)}
      {@const choices = view && agents ? taskOptions(slot, view.slots[slot], view, agents) : null}
      {@const status = view && agents ? taskStatus(slot, view.slots[slot], view, agents) : null}
      <li>
        <div class="v-task-row">
          <div style="min-width: 0;">
            <h3 class="v-h3 m-0">{t(`settings.tasks.${slot}.title`)}</h3>
            <p class="v-muted m-0 mt-1" style="font-size: 12px; line-height: 1.55;">
              {t(`settings.tasks.${slot}.hint`)}
            </p>
            {#if slot === "continuity" && assistantsFound}
              <p class="v-muted m-0 mt-1" style="font-size: 12px; line-height: 1.55;">
                {t("settings.tasks.continuity.noAssistants")}
              </p>
            {/if}
          </div>
          <div data-settings-focus="tasks:{slot}">
            <Select
              label={t(`settings.tasks.${slot}.label`)}
              labelHidden
              minWidth="250px"
              value={choices?.value ?? ""}
              options={choices?.options ?? []}
              groups={choices?.groups ?? []}
              loading={choices === null}
              placeholder={t("settings.common.checking")}
              disabled={models.loading}
              describedBy="tasks-{slot}-status"
              bind:element={selects[slot]}
              onChange={(next) => void choose(slot, next)}
            />
          </div>
        </div>
        <div class="v-row mt-2" style="justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <p id="tasks-{slot}-status" class="v-privacy-bar" data-bar={status?.bar ?? "mute"}>
            {status?.text ?? t("settings.common.checking")}
          </p>
          {#if slot === "continuity"}
            <!-- Focused first: WebKit does not focus a button on a click, and
                 the dialog gives focus back to what held it as it opened. -->
            <button
              class="v-link"
              style="font-size: 12.5px;"
              onclick={(event) => {
                event.currentTarget.focus();
                nav.openManuscript("continuity");
              }}
            >
              {t("settings.tasks.continuity.run")}
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <h3 class="v-h3 mb-2">{t("settings.tasks.notBuilt.title")}</h3>
  <ul class="m-0 mb-6 flex list-none flex-col gap-1 p-0" style="font-size: 12.5px; line-height: 1.6;">
    <li>{t("settings.tasks.notBuilt.chat")}</li>
    <li>{t("settings.tasks.notBuilt.search")}</li>
    <li>{t("settings.tasks.notBuilt.dictation")}</li>
  </ul>

  <p class="m-0" style="font-size: 12.5px;">
    <button class="v-link" onclick={() => nav.navigate({ page: "assistants" })}>
      {t("settings.tasks.seeAssistants")}
    </button>
  </p>
{/if}
