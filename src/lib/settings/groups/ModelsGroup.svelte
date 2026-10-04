<script lang="ts">
  import { onMount, tick } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import { isTauri, type LocalAiView, type ModelCard, type SlotKind } from "$lib/tauri";
  import { models, humanSize } from "$lib/models/state.svelte";
  import { engine } from "$lib/models/engine.svelte";
  import { chrome } from "$lib/chrome/state.svelte";
  import { notices } from "$lib/notices/state.svelte";
  import { store } from "$lib/binder/store.svelte";
  import { restoreFocus } from "$lib/components/restoreFocus";
  import TextField from "$lib/components/forms/TextField.svelte";
  import Select from "$lib/components/forms/Select.svelte";
  import Checkbox from "$lib/components/forms/Checkbox.svelte";
  import { useSettingsNav } from "$lib/settings/nav";
  import { disclosures } from "$lib/settings/disclosures.svelte";
  import {
    isLoopback,
    oneClickCandidate,
    recommendedModel,
    serverAddress,
    sizeWordKey,
    taskNames,
    tasksUsing,
    TASKS,
    TIER_RANK,
    type TaskSlot,
  } from "$lib/settings/ai/picks";
  import ThisComputer from "$lib/settings/models/ThisComputer.svelte";
  import ModelDetails from "$lib/settings/models/ModelDetails.svelte";
  import DownloadProgress from "$lib/settings/models/DownloadProgress.svelte";
  import OllamaRow from "$lib/settings/models/OllamaRow.svelte";
  import LocalServerRow from "$lib/settings/models/LocalServerRow.svelte";

  /**
   * AI › Models: what is on this computer, what else runs models here, and
   * what can be downloaded. Nothing downloads on its own; the one primary
   * button is the first download, offered only while nothing is ready.
   */

  const nav = useSettingsNav();

  let view = $derived(models.view);

  /** The download running now, whichever visit started it. */
  let busyId = $derived(
    models.downloadingId ?? (view?.progress && !view.progress.done ? view.progress.id : null),
  );
  let busyModel = $derived(busyId ? (view?.models.find((m) => m.id === busyId) ?? null) : null);

  let recommended = $derived(view ? recommendedModel(view.models) : null);
  let candidate = $derived(view ? oneClickCandidate(view) : null);
  let bothFree = $derived(
    view !== null && view.slots.rewrite.kind === "none" && view.slots.continuity.kind === "none",
  );

  /** First run: nothing on this computer can write yet. */
  let firstRun = $derived(
    view !== null &&
      !view.models.some((m) => m.task === "writing" && m.state === "ready") &&
      !(view.ollama.running && view.ollama.models.length > 0) &&
      !(view.studio.enabled && view.studio.running && view.studio.models.length > 0),
  );

  // ------------------------------------------------------------ Your models

  type Row =
    | { kind: "builtin"; model: ModelCard }
    | { kind: "ollama"; name: string; sizeBytes: number; modified: string }
    | { kind: "server"; name: string };

  function rank(model: ModelCard, current: LocalAiView): number {
    if (model.task !== "writing") return 5;
    if (model.state === "ready") return tasksUsing("builtin", model.id, current).length > 0 ? 0 : 1;
    if (model.state === "partial") return 2;
    return 3; // corrupt
  }

  let yours = $derived.by<Row[]>(() => {
    if (!view) return [];
    const current = view;
    const own = current.models
      .filter((m) => m.state !== "missing" && (m.task === "writing" || m.state === "ready"))
      .sort(
        (a, b) =>
          rank(a, current) - rank(b, current) ||
          TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
          b.sizeBytes - a.sizeBytes,
      );
    const rows: Row[] = own.filter((m) => m.task === "writing").map((model) => ({ kind: "builtin", model }));
    if (current.ollama.running) {
      for (const o of current.ollama.models) rows.push({ kind: "ollama", ...o });
    }
    if (current.studio.enabled && current.studio.running) {
      for (const name of current.studio.models) rows.push({ kind: "server", name });
    }
    for (const model of own.filter((m) => m.task !== "writing")) rows.push({ kind: "builtin", model });
    return rows;
  });

  let confirming = $state<string | null>(null);

  /** A task runs there: a stopped daemon or a silent server is then a warning. */
  let ollamaInUse = $derived(view !== null && TASKS.some((slot) => view.slots[slot].kind === "ollama"));
  let serverInUse = $derived(view !== null && TASKS.some((slot) => view.slots[slot].kind === "server"));

  function usedBy(kind: SlotKind, id: string): TaskSlot[] {
    return view ? tasksUsing(kind, id, view) : [];
  }

  function updated(when: string): string {
    const date = new Date(when);
    return Number.isNaN(date.getTime()) ? when : date.toLocaleDateString(getLocale());
  }

  async function remove(id: string): Promise<void> {
    confirming = null;
    await models.remove(id);
  }

  async function removeOllama(name: string): Promise<void> {
    confirming = null;
    await models.removeOllama(name);
  }

  async function useForBoth(model: ModelCard): Promise<void> {
    await models.setSlot("rewrite", "builtin", model.id);
    if (models.error) return;
    await models.setSlot("continuity", "builtin", model.id);
    if (models.error) return;
    notices.inform(t("settings.tasks.announce.both", { model: model.label }), "settings.tasks.oneClick");
    // The button goes once both tasks have a model; focus goes to the line
    // that now says so ("Used by Rewrite and Continuity"), not to nowhere.
    await tick();
    if (focusLost()) restoreFocus(modelRow(model.id)?.querySelector("[data-used-by]"));
  }

  // ---------------------------------------------------------- downloading

  /** Focus is nowhere: the control that held it has just gone. */
  function focusLost(): boolean {
    const el = document.activeElement;
    return el === null || el === document.body;
  }

  /** A model's row, in Your models or in the catalogue, by `data-model`. */
  function modelRow(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-model="${CSS.escape(id)}"]`);
  }

  /**
   * Start a download, say so, and say when it is done. The button pressed
   * turns into the bar and its Cancel, so focus moves to Cancel; at the end
   * the row moves to Your models (or the callout goes), so focus moves to
   * what the new model can do: "Use for Rewrite and Continuity", or its row.
   */
  async function download(model: ModelCard): Promise<void> {
    void chrome.announce(t("settings.models.available.downloading", { model: model.label }));
    const running = models.download(model.id);
    await tick();
    restoreFocus(modelRow(model.id)?.querySelector("[data-cancel]"));
    await running;
    await tick();
    const now = models.view?.models.find((m) => m.id === model.id);
    if (now?.state !== "ready") {
      if (focusLost()) restoreFocus(modelRow(model.id)?.querySelector("button"));
      return;
    }
    notices.inform(t("settings.models.available.done", { model: model.label }), "settings.models.download");
    if (!focusLost()) return;
    const use = document.querySelector(`[data-settings-focus="models:use:${CSS.escape(model.id)}"] button`);
    if (!restoreFocus(use)) restoreFocus(modelRow(model.id)?.querySelector("button"));
  }

  /** Stop a download; the Cancel pressed goes with the bar, so focus goes to the row's button. */
  async function cancel(id: string): Promise<void> {
    await models.cancel(id);
    await tick();
    if (focusLost()) restoreFocus(modelRow(id)?.querySelector("button"));
  }

  function downloading(model: ModelCard): boolean {
    return busyId === model.id;
  }

  // ------------------------------------------------------- the catalogue

  type Sort = "recommended" | "smallest" | "largest" | "name";
  const SORTS: Sort[] = ["recommended", "smallest", "largest", "name"];

  let query = $state("");
  let family = $state("all");
  let onlyFits = $state(false);
  let sort = $state<Sort>("recommended");

  /** Catalogue writing models not on this computer, uncensored ones only while shown. */
  let catalogue = $derived(
    view
      ? view.models.filter((m) => m.task === "writing" && m.state === "missing" && !(view.censorship && m.uncensored))
      : [],
  );
  let families = $derived([...new Set(catalogue.map((m) => m.family))].sort());

  let available = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const matches = catalogue.filter(
      (m) =>
        (family === "all" || m.family === family) &&
        (!onlyFits || m.fits) &&
        (needle === "" || `${m.label} ${m.family} ${m.params} ${m.quant}`.toLowerCase().includes(needle)),
    );
    const order: Record<Sort, (a: ModelCard, b: ModelCard) => number> = {
      recommended: (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.sizeBytes - b.sizeBytes,
      smallest: (a, b) => a.sizeBytes - b.sizeBytes,
      largest: (a, b) => b.sizeBytes - a.sizeBytes,
      name: (a, b) => a.label.localeCompare(b.label, getLocale()),
    };
    return matches.sort(order[sort]);
  });

  let everythingHere = $derived(
    view !== null && !view.models.some((m) => m.task === "writing" && m.state === "missing"),
  );

  async function showUncensored(show: boolean): Promise<void> {
    try {
      await models.setCensorship(show);
      notices.dismiss("settings.censorship");
    } catch (e) {
      notices.fail(store.codeMessagePublic(e), "settings.censorship");
    }
  }

  // ------------------------------------------------- other apps, expanded

  let ollamaOpen = $state(disclosures.isOpen("models:ollama"));
  let serverOpen = $state(disclosures.isOpen("models:server"));
  $effect(() => disclosures.set("models:ollama", ollamaOpen));
  $effect(() => disclosures.set("models:server", serverOpen));

  onMount(() => {
    if (!isTauri()) return;
    void engine.poll();
  });

  function meta(model: ModelCard): string {
    return [t(sizeWordKey(model.tier)), humanSize(model.sizeBytes)].join(" · ");
  }

  /** "In Versorium · Small · 819 MB ·", the start of an own model's line. */
  function ownMeta(model: ModelCard): string {
    const parts = [t("settings.models.yours.inVersorium")];
    if (model.task === "writing") parts.push(t(sizeWordKey(model.tier)));
    parts.push(humanSize(model.sizeBytes));
    return `${parts.join(" · ")} ·`;
  }
</script>

{#if !isTauri()}
  <p class="v-muted m-0" style="font-size: 13px;">{t("settings.common.desktopOnly")}</p>
{:else if !view}
  <p class="v-muted m-0" style="font-size: 13px;">{t("settings.common.checking")}</p>
{:else}
  {#if engine.failed}
    <p class="m-0 mb-3" style="font-size: 12.5px; line-height: 1.6; color: var(--warn);">{t("settings.common.engineDown")}</p>
  {/if}
  {#if models.error}
    <p role="alert" class="m-0 mb-3" style="font-size: 12.5px; color: var(--warn);">{models.error}</p>
  {/if}

  <section class="mb-6">
    <ThisComputer {view} />
  </section>

  {#if firstRun && recommended}
    {@const partial = recommended.state === "partial"}
    <div class="v-card mb-6 p-3" style="border-color: var(--accent);" data-model={recommended.id}>
      <p class="m-0" style="font-size: 13px; line-height: 1.6;">
        {t("settings.models.start.text", {
          model: recommended.label,
          size: t(sizeWordKey(recommended.tier)),
          bytes: humanSize(recommended.sizeBytes),
        })}
      </p>
      <div class="mt-3">
        {#if downloading(recommended)}
          <DownloadProgress model={recommended} onCancel={cancel} />
        {:else}
          <span data-settings-focus="models:start">
            <button
              class="v-btn v-btn-primary"
              disabled={busyId !== null}
              onclick={() => void download(recommended)}
            >
              {t(partial ? "settings.models.start.resume" : "settings.models.start.download", { model: recommended.label })}
            </button>
          </span>
        {/if}
      </div>
    </div>
  {/if}

  {#if yours.length > 0}
    <section class="mb-6" aria-labelledby="models-yours-title">
      <h3 id="models-yours-title" class="v-h3 mb-2">{t("settings.models.yours.title")}</h3>
      <ul class="v-boxed">
        {#each yours as row (row.kind === "builtin" ? `b:${row.model.id}` : `${row.kind}:${row.name}`)}
          <li data-model={row.kind === "builtin" ? row.model.id : undefined}>
            {#if row.kind === "builtin"}
              {@const model = row.model}
              {@const tasks = usedBy("builtin", model.id)}
              <div class="v-model-row">
                <div style="min-width: 0; flex: 1;">
                  <div class="v-row" style="gap: 8px; flex-wrap: wrap;">
                    <b style="font-size: 13px;">{model.label}</b>
                    {#if model.uncensored}<span class="v-tag">{t("settings.models.available.uncensored")}</span>{/if}
                  </div>
                  <p class="v-muted m-0 mt-1" style="font-size: 12px; line-height: 1.55;">
                    {ownMeta(model)}
                    {#if model.task !== "writing"}
                      {t("settings.models.yours.notWriting")}
                    {:else if model.state === "partial"}
                      {t("settings.models.yours.paused", {
                        done: humanSize(model.receivedBytes),
                        total: humanSize(model.sizeBytes),
                      })}
                    {:else if model.state === "corrupt"}
                      <span style="color: var(--warn);">{t("settings.models.yours.damaged")}</span>
                    {:else if tasks.length > 0}
                      <button class="v-link" data-used-by onclick={() => nav.navigate({ page: "tasks", focus: tasks[0] })}>
                        {t("settings.models.yours.usedBy", { tasks: taskNames(tasks) })}
                      </button>
                    {:else}
                      {t("settings.models.yours.unused")}
                    {/if}
                  </p>
                  {#if model.task === "writing" && model.state === "ready" && !model.fits}
                    <p class="m-0 mt-1" style="font-size: 12px; color: var(--warn);">{t("settings.models.yours.tooLarge")}</p>
                  {/if}
                </div>
                <div class="v-model-actions">
                  {#if downloading(model)}
                    <DownloadProgress {model} onCancel={cancel} />
                  {:else}
                    {#if model.task === "writing" && model.state === "ready" && bothFree && candidate?.id === model.id}
                      <span data-settings-focus="models:use:{model.id}">
                        <button class="v-btn" disabled={models.loading} onclick={() => void useForBoth(model)}>
                          {t("settings.models.yours.useForBoth")}
                        </button>
                      </span>
                    {/if}
                    {#if model.state === "partial"}
                      <button class="v-btn" disabled={busyId !== null} onclick={() => void download(model)}>
                        {t("settings.models.yours.resume")}
                      </button>
                    {:else if model.state === "corrupt"}
                      <button class="v-btn" disabled={busyId !== null} onclick={() => void download(model)}>
                        {t("settings.models.yours.downloadAgain")}
                      </button>
                    {/if}
                    {#if confirming === `b:${model.id}`}
                      <button class="v-btn" style="color: var(--warn);" onclick={() => void remove(model.id)}>
                        {t("settings.models.yours.confirmDelete")}
                      </button>
                      <button class="v-btn" onclick={() => (confirming = null)}>{t("settings.models.yours.keep")}</button>
                    {:else}
                      <button class="v-btn" disabled={models.loading} onclick={() => (confirming = `b:${model.id}`)}>
                        {t("settings.models.yours.delete")}
                      </button>
                    {/if}
                  {/if}
                </div>
              </div>
              {#if model.task === "writing"}
                <div class="mt-1"><ModelDetails {model} /></div>
              {/if}
            {:else if row.kind === "ollama"}
              {@const tasks = usedBy("ollama", row.name)}
              <div class="v-model-row">
                <div style="min-width: 0; flex: 1;">
                  <b class="v-mono-select" style="font-size: 13px;">{row.name}</b>
                  <p class="v-muted m-0 mt-1" style="font-size: 12px; line-height: 1.55;">
                    {t("settings.models.yours.inOllama")} · {humanSize(row.sizeBytes)} ·
                    {t("settings.models.yours.updated", { when: updated(row.modified) })} ·
                    {#if tasks.length > 0}
                      <button class="v-link" onclick={() => nav.navigate({ page: "tasks", focus: tasks[0] })}>
                        {t("settings.models.yours.usedBy", { tasks: taskNames(tasks) })}
                      </button>
                    {:else}
                      {t("settings.models.yours.unused")}
                    {/if}
                  </p>
                </div>
                <div class="v-model-actions">
                  {#if confirming === `o:${row.name}`}
                    <button class="v-btn" style="color: var(--warn);" onclick={() => void removeOllama(row.name)}>
                      {t("settings.models.yours.confirmRemove")}
                    </button>
                    <button class="v-btn" onclick={() => (confirming = null)}>{t("settings.models.yours.keep")}</button>
                  {:else}
                    <button class="v-btn" disabled={models.loading} onclick={() => (confirming = `o:${row.name}`)}>
                      {t("settings.models.yours.remove")}
                    </button>
                  {/if}
                </div>
              </div>
            {:else}
              {@const tasks = usedBy("server", row.name)}
              <b class="v-mono-select" style="font-size: 13px;">{row.name}</b>
              <p class="v-muted m-0 mt-1" style="font-size: 12px; line-height: 1.55;">
                <!-- Saved at another computer's address, it is not "local": said
                     as Tasks and the Rewrite dialog say it. -->
                {isLoopback(view.studio.host)
                  ? t("settings.models.yours.onServer")
                  : t("settings.models.yours.onServerAt", { address: serverAddress(view.studio) })} ·
                {#if tasks.length > 0}
                  <button class="v-link" onclick={() => nav.navigate({ page: "tasks", focus: tasks[0] })}>
                    {t("settings.models.yours.usedBy", { tasks: taskNames(tasks) })}
                  </button>
                {:else}
                  {t("settings.models.yours.unused")}
                {/if}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="mb-6" aria-labelledby="models-apps-title">
    <h3 id="models-apps-title" class="v-h3 mb-2">{t("settings.models.apps.title")}</h3>
    <div class="v-card">
      <OllamaRow {view} bind:open={ollamaOpen} inUse={ollamaInUse} />
      <LocalServerRow {view} bind:open={serverOpen} inUse={serverInUse} />
    </div>
  </section>

  <section aria-labelledby="models-available-title">
    <h3 id="models-available-title" class="v-h3 mb-1">{t("settings.models.available.title")}</h3>
    <p class="v-muted m-0 mb-3" style="font-size: 12.5px; line-height: 1.6;">{t("settings.models.available.intro")}</p>

    <div class="v-row mb-2" style="gap: 10px; align-items: flex-end; flex-wrap: wrap;">
      <TextField
        type="search"
        label={t("settings.models.filter.search")}
        labelHidden
        placeholder={t("settings.models.filter.search")}
        value={query}
        grow
        onInput={(next) => (query = next)}
      />
      <Select
        label={t("settings.models.filter.family")}
        inline
        value={family}
        options={[
          { value: "all", label: t("settings.models.filter.allFamilies") },
          ...families.map((name) => ({ value: name, label: name })),
        ]}
        onChange={(next) => (family = next)}
      />
      <Select
        label={t("settings.models.filter.sort")}
        inline
        value={sort}
        options={SORTS.map((option) => ({ value: option, label: t(`settings.models.filter.sorts.${option}`) }))}
        onChange={(next) => (sort = next)}
      />
    </div>
    <div class="v-row mb-3" style="gap: 18px; align-items: flex-start; flex-wrap: wrap;">
      <Checkbox
        label={t("settings.models.available.fitsOnly")}
        checked={onlyFits}
        onChange={(next) => (onlyFits = next)}
      />
      <Checkbox
        label={t("settings.models.available.showUncensored")}
        hint={t("settings.models.available.showUncensoredHint")}
        checked={!view.censorship}
        onChange={(next) => void showUncensored(next)}
      />
      <p class="v-muted m-0" style="font-size: 12px; margin-left: auto;" aria-live="polite">
        {t("settings.models.filter.showing", { shown: available.length, total: catalogue.length })}
      </p>
    </div>

    {#if busyModel}
      <p id="models-one-at-a-time" class="v-muted m-0 mb-2" style="font-size: 12px;">
        {t("settings.models.available.oneAtATime", { model: busyModel.label })}
      </p>
    {/if}

    {#if everythingHere}
      <p class="v-muted m-0" style="font-size: 13px;">{t("settings.models.available.allHere")}</p>
    {:else if available.length === 0}
      <p class="v-muted m-0" style="font-size: 13px;">{t("settings.models.filter.noMatch")}</p>
    {:else}
      <ul class="v-boxed" aria-labelledby="models-available-title">
        {#each available as model (model.id)}
          <li data-model={model.id}>
            <div class="v-model-row">
              <div style="min-width: 0; flex: 1;">
                <div class="v-row" style="gap: 8px; flex-wrap: wrap;">
                  <b style="font-size: 13px;">{model.label}</b>
                  {#if recommended?.id === model.id}
                    <span class="v-tag">{t("settings.models.available.recommended")}</span>
                  {/if}
                  {#if model.uncensored}<span class="v-tag">{t("settings.models.available.uncensored")}</span>{/if}
                </div>
                <p class="m-0 mt-1" style="font-size: 12px; line-height: 1.55;">
                  <span class="v-muted">{meta(model)} ·</span>
                  {#if model.fits}
                    <span class="v-muted">{t("settings.models.fit.yes")}</span>
                  {:else}
                    <span style="color: var(--warn);">{t("settings.models.fit.no")}</span>
                  {/if}
                </p>
              </div>
              <div class="v-model-actions">
                {#if downloading(model)}
                  <DownloadProgress {model} onCancel={cancel} />
                {:else}
                  <button
                    class="v-btn"
                    disabled={busyId !== null}
                    aria-describedby={busyId !== null ? "models-one-at-a-time" : undefined}
                    onclick={() => void download(model)}
                  >
                    {t("settings.models.available.download")}
                  </button>
                {/if}
              </div>
            </div>
            <div class="mt-1"><ModelDetails {model} /></div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
