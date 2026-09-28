<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import { isTauri, type ModelCard, type SlotKind, type SlotName } from "$lib/tauri";
  import { models, humanSize, percent } from "$lib/models/state.svelte";

  type Tab = "writing" | "ollama" | "studio" | "dictation";
  const TABS: Tab[] = ["writing", "ollama", "studio", "dictation"];
  /** Light to largest, so the ladder reads top-down like the spec describes it. */
  const TIER_ORDER = ["low", "mid", "midPlus", "high"];
  const SLOTS: SlotName[] = ["rewrite", "chat", "continuity", "embeddings", "dictation"];

  /** Weight icon per speed (spec §6.2): rocket, lightning, flame. */
  const SPEED_GLYPH: Record<ModelCard["speed"], string> = {
    fast: "🚀",
    balanced: "⚡",
    slow: "🔥",
  };

  let tab = $state<Tab>("writing");
  let tabRefs: HTMLButtonElement[] = [];
  let confirmingDelete = $state<string | null>(null);
  let confirmingOllama = $state<string | null>(null);
  let pullName = $state("");
  let studioHost = $state("127.0.0.1");
  let studioPort = $state(1234);
  let studioEnabled = $state(false);

  let view = $derived(models.view);
  let progress = $derived(view?.progress ?? null);

  let writing = $derived(
    [...models.writing].sort(
      (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.sizeBytes - b.sizeBytes,
    ),
  );

  /** Built-in models a slot may point at — only what is actually on disk. */
  let ready = $derived(models.models.filter((m) => m.state === "ready"));

  onMount(() => {
    if (!isTauri()) return;
    void models.load().then(() => {
      const studio = models.view?.studio;
      if (studio) {
        studioHost = studio.host;
        studioPort = studio.port;
        studioEnabled = studio.enabled;
      }
    });
  });

  onDestroy(() => models.dispose());

  function selectTab(next: Tab): void {
    tab = next;
    confirmingDelete = null;
    confirmingOllama = null;
  }

  /** Arrow keys move between tabs, as a tablist is expected to. */
  function onTabKey(event: KeyboardEvent, index: number): void {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + TABS.length) % TABS.length;
    selectTab(TABS[next]);
    tabRefs[next]?.focus();
  }

  function isSelected(model: ModelCard): boolean {
    const slots = view?.slots;
    if (!slots) return false;
    return SLOTS.some((slot) => slots[slot].kind === "builtin" && slots[slot].id === model.id);
  }

  function downloading(model: ModelCard): boolean {
    return progress?.id === model.id && !progress.done;
  }

  async function onDelete(model: ModelCard): Promise<void> {
    confirmingDelete = null;
    await models.remove(model.id);
  }

  async function onRemoveOllama(name: string): Promise<void> {
    confirmingOllama = null;
    await models.removeOllama(name);
  }

  function slotValue(slot: SlotName): string {
    const assignment = view?.slots[slot];
    if (!assignment || assignment.kind === "none") return "none";
    return `${assignment.kind}:${assignment.id}`;
  }

  function onSlotChange(slot: SlotName, raw: string): void {
    if (raw === "none") {
      void models.setSlot(slot, "none", "");
      return;
    }
    const [kind, ...rest] = raw.split(":");
    void models.setSlot(slot, kind as SlotKind, rest.join(":"));
  }

  function modified(when: string): string {
    const date = new Date(when);
    return Number.isNaN(date.getTime()) ? when : date.toLocaleDateString(getLocale());
  }
</script>

<section class="mb-6" aria-label={t("localAi.title")}>
  <div class="v-row mb-2" style="justify-content: space-between;">
    <h3 class="v-section-title m-0">{t("localAi.title")}</h3>
    {#if isTauri()}
      <button
        class="v-btn"
        style="padding: 2px 10px; font-size: 12px;"
        disabled={models.loading}
        onclick={() => void models.load()}
      >
        {t("localAi.refresh")}
      </button>
    {/if}
  </div>
  <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("localAi.intro")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("localAi.none")}</p>
  {:else}
    {#if models.error}
      <p role="alert" class="m-0 mb-3" style="font-size: 12px; color: var(--warn);">{models.error}</p>
    {/if}

    <div class="v-row mb-3" style="gap: 4px;" role="tablist" aria-label={t("localAi.title")}>
      {#each TABS as name, i (name)}
        <button
          bind:this={tabRefs[i]}
          class="v-btn"
          role="tab"
          id="localai-tab-{name}"
          aria-controls="localai-panel-{name}"
          aria-selected={tab === name}
          tabindex={tab === name ? 0 : -1}
          style="padding: 4px 12px; font-size: 12.5px; {tab === name
            ? 'background: var(--accent); color: var(--accent-contrast); border-color: var(--accent);'
            : ''}"
          onclick={() => selectTab(name)}
          onkeydown={(e) => onTabKey(e, i)}
        >
          {t(`localAi.tabs.${name}`)}
        </button>
      {/each}
    </div>

    <!-- Writing: the built-in GGUF ladder -->
    <div
      id="localai-panel-writing"
      role="tabpanel"
      aria-labelledby="localai-tab-writing"
      hidden={tab !== "writing"}
    >
      {#if view}
        <div class="v-card mb-3 p-3">
          <b style="font-size: 13px;">{t("localAi.wizard.title")}</b>
          <p class="v-muted m-0 mt-1" style="font-size: 12px;">
            {t("localAi.wizard.ram")}: {view.hardware.totalRamGb.toFixed(1)} GB ·
            {t("localAi.wizard.cores")}: {view.hardware.cpuCores} ·
            {t("localAi.wizard.platform")}: {view.hardware.os}/{view.hardware.arch} ·
            {t("localAi.wizard.gpu")}: {view.hardware.gpu}
          </p>
          <p class="m-0 mt-2" style="font-size: 12.5px;">
            {t("localAi.wizard.recommended", {
              ram: `${view.hardware.totalRamGb.toFixed(1)} GB`,
              tier: t(`localAi.tiers.${view.hardware.recommendedTier}`),
            })}
          </p>
          <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("localAi.wizard.hint")}</p>
        </div>
      {/if}

      {#if writing.length === 0}
        <p class="v-muted m-0" style="font-size: 13px;">{t("localAi.card.empty")}</p>
      {:else}
        <ul class="m-0 flex list-none flex-col gap-2 p-0" aria-busy={models.loading}>
          {#each writing as m (m.id)}
            {@const selected = isSelected(m)}
            {@const recommended = view?.hardware.recommendedTier === m.tier}
            <li
              class="v-card p-3"
              style={selected
                ? "border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev));"
                : recommended
                  ? "border-color: var(--accent);"
                  : ""}
            >
              <div class="v-row" style="justify-content: space-between; gap: 12px; align-items: flex-start;">
                <div style="min-width: 0;">
                  <div class="v-row" style="gap: 8px; flex-wrap: wrap;">
                    <span aria-hidden="true">{SPEED_GLYPH[m.speed]}</span>
                    <b style="font-size: 13px;">{m.label}</b>
                    {#if m.badge}
                      <span
                        style="padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--sel);"
                      >
                        {m.badge}
                      </span>
                    {/if}
                    {#if recommended}
                      <span
                        style="padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--accent-contrast); background: var(--accent);"
                      >
                        {t("localAi.wizard.recommendedBadge")}
                      </span>
                    {/if}
                    {#if m.uncensored}
                      <span
                        style="padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--sel);"
                      >
                        {t("localAi.card.uncensored")}
                      </span>
                    {/if}
                  </div>
                  <p class="v-muted m-0 mt-1" style="font-size: 12px;">
                    {t("localAi.card.oneLiner", {
                      speed: t(`localAi.speeds.${m.speed}`),
                      quality: t(`localAi.qualities.${m.quality}`),
                    })}
                  </p>
                  <p class="v-muted m-0 mt-1" style="font-size: 12px;">
                    {t("localAi.card.meta", {
                      size: humanSize(m.sizeBytes),
                      quality: t(`localAi.qualities.${m.quality}`),
                      quant: m.quant,
                      ctx: m.ctx.toLocaleString(getLocale()),
                      ram: `${m.ramHintGB} GB`,
                    })}
                  </p>
                  <p class="v-muted m-0 mt-1" style="font-size: 11px;">
                    {t("localAi.card.license")}: {m.license} · {m.repo}
                  </p>
                  {#if !m.fits}
                    <p class="m-0 mt-1" style="font-size: 12px; color: var(--warn);">{t("localAi.card.tooBig")}</p>
                  {/if}
                  {#if m.state === "corrupt"}
                    <p class="m-0 mt-1" style="font-size: 12px; color: var(--warn);">{t("localAi.card.corrupt")}</p>
                  {/if}
                </div>

                <div class="v-row" style="gap: 8px; flex-shrink: 0;">
                  {#if downloading(m)}
                    <span style="font-size: 12px; font-variant-numeric: tabular-nums;" aria-live="polite">
                      {percent(progress?.received ?? 0, progress?.total ?? 0)}%
                    </span>
                    <button class="v-btn" onclick={() => void models.cancel(m.id)}>
                      {t("localAi.card.cancel")}
                    </button>
                  {:else if m.state === "ready"}
                    <span class="v-row" style="gap: 6px; font-size: 12px;">
                      <span
                        aria-hidden="true"
                        style="width: 8px; height: 8px; border-radius: 50%; background: var(--ok);"
                      ></span>
                      {selected ? t("localAi.card.selected") : t("localAi.card.ready")}
                    </span>
                  {:else}
                    <button class="v-btn v-btn-primary" disabled={models.loading} onclick={() => void models.download(m.id)}>
                      {m.state === "partial" ? t("localAi.card.resume") : t("localAi.card.download")}
                    </button>
                  {/if}

                  {#if m.state === "ready" || m.state === "partial" || m.state === "corrupt"}
                    {#if confirmingDelete === m.id}
                      <button class="v-btn" style="color: var(--warn);" onclick={() => void onDelete(m)}>
                        {t("localAi.card.confirmDelete")}
                      </button>
                      <button class="v-btn" onclick={() => (confirmingDelete = null)}>
                        {t("localAi.card.keep")}
                      </button>
                    {:else if !downloading(m)}
                      <button class="v-btn" onclick={() => (confirmingDelete = m.id)}>
                        {t("localAi.card.delete")}
                      </button>
                    {/if}
                  {/if}
                </div>
              </div>

              {#if m.state === "partial" && !downloading(m)}
                <p class="v-muted m-0 mt-1" style="font-size: 12px;">
                  {t("localAi.card.partial", { done: humanSize(m.receivedBytes), total: humanSize(m.sizeBytes) })}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if view}
        <p class="v-muted m-0 mt-2" style="font-size: 11.5px;">
          {t("localAi.diskUsed", { size: humanSize(view.diskUsedBytes) })}
          · {t("localAi.modelsDir")}
          <span style="font-family: var(--font-mono, ui-monospace, monospace);">{view.modelsDir}</span>
        </p>
      {/if}
    </div>

    <!-- Ollama: whatever the local daemon already serves -->
    <div id="localai-panel-ollama" role="tabpanel" aria-labelledby="localai-tab-ollama" hidden={tab !== "ollama"}>
      {#if view}
        <div class="v-row mb-2" style="gap: 8px;">
          <span
            style="padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--accent-contrast); background: {view
              .ollama.running
              ? 'var(--ok)'
              : 'var(--text-mute)'};"
          >
            {view.ollama.running ? t("localAi.ollama.running") : t("localAi.ollama.offline")}
          </span>
        </div>
        {#if !view.ollama.installed}
          <p class="v-muted m-0 mb-2" style="font-size: 12.5px;">{t("localAi.ollama.notInstalled")}</p>
          <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("localAi.ollama.installHint")}</p>
        {:else if !view.ollama.running}
          <p class="v-muted m-0 mb-3" style="font-size: 12.5px;">{t("localAi.ollama.offlineHint")}</p>
        {/if}

        <div class="v-row mb-3" style="gap: 8px;">
          <input
            type="text"
            placeholder={t("localAi.ollama.pullPlaceholder")}
            bind:value={pullName}
            style="flex: 1;"
          />
          <button
            class="v-btn"
            disabled={models.loading || !pullName.trim()}
            onclick={() => void models.pullOllama(pullName).then(() => (pullName = ""))}
          >
            {t("localAi.ollama.pull")}
          </button>
        </div>

        <b style="font-size: 13px;">{t("localAi.ollama.pulled")}</b>
        {#if view.ollama.models.length === 0}
          <p class="v-muted m-0 mt-1" style="font-size: 13px;">{t("localAi.ollama.empty")}</p>
        {:else}
          <ul class="m-0 mt-2 flex list-none flex-col gap-2 p-0" aria-label={t("localAi.ollama.pulled")}>
            {#each view.ollama.models as o (o.name)}
              <li class="v-card v-row p-3" style="justify-content: space-between; gap: 12px;">
                <div style="min-width: 0;">
                  <b style="font-size: 13px; font-family: var(--font-mono, ui-monospace, monospace);">{o.name}</b>
                  <p class="v-muted m-0 mt-1" style="font-size: 12px;">
                    {humanSize(o.sizeBytes)} · {t("localAi.ollama.modified", { when: modified(o.modified) })}
                  </p>
                </div>
                <div class="v-row" style="gap: 8px; flex-shrink: 0;">
                  {#if confirmingOllama === o.name}
                    <button class="v-btn" style="color: var(--warn);" onclick={() => void onRemoveOllama(o.name)}>
                      {t("localAi.ollama.confirmRemove")}
                    </button>
                    <button class="v-btn" onclick={() => (confirmingOllama = null)}>{t("localAi.card.keep")}</button>
                  {:else}
                    <button class="v-btn" onclick={() => (confirmingOllama = o.name)}>
                      {t("localAi.ollama.remove")}
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <!-- Studio: any OpenAI-compatible server already running here -->
    <div id="localai-panel-studio" role="tabpanel" aria-labelledby="localai-tab-studio" hidden={tab !== "studio"}>
      <p class="v-muted m-0 mb-3" style="font-size: 12.5px;">{t("localAi.studio.intro")}</p>
      <div class="v-row mb-2" style="gap: 8px; flex-wrap: wrap;">
        <label class="v-row" style="gap: 8px; font-size: 13px;">
          {t("localAi.studio.host")}
          <input type="text" bind:value={studioHost} style="width: 160px;" />
        </label>
        <label class="v-row" style="gap: 8px; font-size: 13px;">
          {t("localAi.studio.port")}
          <input type="number" bind:value={studioPort} min="1" max="65535" style="width: 96px;" />
        </label>
        <button class="v-btn" disabled={models.loading} onclick={() => void models.testStudio(studioHost, studioPort)}>
          {t("localAi.studio.test")}
        </button>
      </div>
      {#if models.studioReachable !== null}
        <p
          class="m-0 mb-2"
          aria-live="polite"
          style="font-size: 12.5px; color: {models.studioReachable ? 'var(--ok)' : 'var(--warn)'};"
        >
          {models.studioReachable ? t("localAi.studio.reachable") : t("localAi.studio.unreachable")}
        </p>
      {/if}
      <label class="v-row mb-2" style="gap: 8px; font-size: 13px;">
        <input type="checkbox" bind:checked={studioEnabled} />
        {t("localAi.studio.enable")}
      </label>
      <button
        class="v-btn"
        disabled={models.loading}
        onclick={() => void models.saveStudio(studioHost, studioPort, studioEnabled)}
      >
        {t("localAi.studio.save")}
      </button>
    </div>

    <!-- Dictation: the downloader is here, the Whisper packs are not yet -->
    <div
      id="localai-panel-dictation"
      role="tabpanel"
      aria-labelledby="localai-tab-dictation"
      hidden={tab !== "dictation"}
    >
      <p class="v-muted m-0 mb-2" style="font-size: 12.5px;">{t("localAi.dictation.intro")}</p>
      {#if models.dictation.length === 0}
        <p class="v-muted m-0" style="font-size: 13px;">{t("localAi.dictation.soon")}</p>
      {:else}
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          {#each models.dictation as m (m.id)}
            <li class="v-card v-row p-3" style="justify-content: space-between; gap: 12px;">
              <div>
                <b style="font-size: 13px;">{m.label}</b>
                <p class="v-muted m-0 mt-1" style="font-size: 12px;">
                  {humanSize(m.sizeBytes)} · {m.quant}
                </p>
              </div>
              {#if m.state === "ready"}
                <span class="v-row" style="gap: 6px; font-size: 12px;">
                  <span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 50%; background: var(--ok);"
                  ></span>
                  {t("localAi.card.ready")}
                </span>
              {:else}
                <button class="v-btn" disabled={models.loading} onclick={() => void models.download(m.id)}>
                  {t("localAi.card.download")}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Slots: a model per task, not one model for everything -->
    {#if view}
      <div class="mt-4">
        <b style="font-size: 13px;">{t("localAi.slots.title")}</b>
        <p class="v-muted m-0 mt-1 mb-2" style="font-size: 12px;">{t("localAi.slots.intro")}</p>
        <ul class="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("localAi.slots.title")}>
          {#each SLOTS as slot (slot)}
            <li class="v-row" style="justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <div style="min-width: 0;">
                <span style="font-size: 13px;">{t(`localAi.slots.${slot}`)}</span>
                <p class="v-muted m-0" style="font-size: 12px;">{t(`localAi.slots.${slot}Hint`)}</p>
              </div>
              <select
                aria-label={t(`localAi.slots.${slot}`)}
                value={slotValue(slot)}
                disabled={models.loading}
                onchange={(e) => onSlotChange(slot, (e.currentTarget as HTMLSelectElement).value)}
                style="min-width: 200px;"
              >
                <option value="none">{t("localAi.slots.none")}</option>
                {#if ready.length > 0}
                  <optgroup label={t("localAi.slots.builtin")}>
                    {#each ready as m (m.id)}
                      <option value="builtin:{m.id}">{m.label}</option>
                    {/each}
                  </optgroup>
                {/if}
                {#if view.ollama.models.length > 0}
                  <optgroup label={t("localAi.slots.ollamaGroup")}>
                    {#each view.ollama.models as o (o.name)}
                      <option value="ollama:{o.name}">{o.name}</option>
                    {/each}
                  </optgroup>
                {/if}
              </select>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>
