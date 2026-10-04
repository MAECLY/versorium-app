<script lang="ts">
  import { t } from "$lib/i18n";
  import { isTauri } from "$lib/tauri";
  import Modal from "$lib/components/Modal.svelte";
  import { sizeWordKey } from "$lib/settings/ai/picks";
  import {
    onboarding,
    STEPS,
    TEMPLATES,
    isLastStep,
    templateChapterKeys,
    type TemplateId,
  } from "$lib/onboarding/state.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const LANGUAGES = ["en", "es"] as const;

  let titles = $derived(templateChapterKeys(onboarding.template).map((key) => t(key)));

  async function close(): Promise<void> {
    await onboarding.skip();
    onClose();
  }

  async function done(): Promise<void> {
    await onboarding.finish();
    onClose();
  }

  function choose(template: TemplateId): void {
    onboarding.template = template;
  }
</script>

<Modal label={t("onboarding.title")} onClose={() => void close()} wide>
  <div class="v-row flex-shrink-0" style="justify-content: space-between;">
    <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("onboarding.title")}</h2>
    <span class="v-muted" style="font-size: 12px;">
      {t("onboarding.stepOf", { step: onboarding.stepIndex + 1, total: STEPS.length })}
    </span>
  </div>

  <ol
    class="v-row m-0 mt-2 list-none p-0"
    style="gap: 6px;"
    aria-label={t("onboarding.steps")}
  >
    {#each STEPS as step, index (step)}
      <li
        aria-current={onboarding.step === step ? "step" : undefined}
        style="height: 3px; flex: 1; border-radius: 999px; background: {index <= onboarding.stepIndex
          ? 'var(--accent)'
          : 'var(--border)'}; transition: background 150ms ease-out;"
      >
        <span class="sr-only">{t(`onboarding.step.${step}`)}</span>
      </li>
    {/each}
  </ol>

  <div class="min-h-0 flex-1 overflow-y-auto py-4">
    {#if onboarding.step === "machine"}
      <h3 class="v-section-title mb-2">{t("onboarding.step.machine")}</h3>
      {#if onboarding.hardware}
        <p class="m-0" style="font-size: 13px;">
          {t("onboarding.machineSummary", {
            ram: `${Math.round(onboarding.hardware.totalRamGb)} GB`,
            cores: onboarding.hardware.cpuCores,
            size: t(sizeWordKey(onboarding.hardware.recommendedTier)),
          })}
        </p>
      {:else}
        <p class="v-muted m-0" style="font-size: 13px;">{t("onboarding.machineUnknown")}</p>
      {/if}
      <p class="v-muted m-0 mt-2" style="font-size: 12px;">{t("onboarding.machineHint")}</p>

    {:else if onboarding.step === "agents"}
      <h3 class="v-section-title mb-2">{t("onboarding.step.agents")}</h3>
      <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("onboarding.agentsHint")}</p>
      {#if onboarding.agents.length === 0}
        <p class="v-muted m-0" style="font-size: 13px;">{t("onboarding.agentsNone")}</p>
      {:else}
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          {#each onboarding.agents as agent (agent.id)}
            <li class="v-row" style="gap: 8px; font-size: 13px;">
              <span
                aria-hidden="true"
                style="width: 8px; height: 8px; border-radius: 50%; background: {agent.state ===
                'missing'
                  ? 'var(--text-mute)'
                  : 'var(--ok)'};"
              ></span>
              <span>{agent.name}</span>
              <span class="v-muted" style="font-size: 12px;">{t(`agents.${agent.state}`)}</span>
            </li>
          {/each}
        </ul>
      {/if}

    {:else if onboarding.step === "project"}
      <h3 class="v-section-title mb-2">{t("onboarding.step.project")}</h3>
      <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("onboarding.projectHint")}</p>
      <label class="flex flex-col gap-1" style="font-size: 13px;">
        {t("dialog.title")}
        <input
          bind:value={onboarding.title}
          placeholder={t("dialog.titlePlaceholder")}
          disabled={onboarding.created || onboarding.busy}
        />
      </label>
      <label class="mt-3 flex flex-col gap-1" style="font-size: 13px;">
        {t("dialog.language")}
        <span class="v-select">
        <select bind:value={onboarding.language} disabled={onboarding.created || onboarding.busy}>
          {#each LANGUAGES as code (code)}
            <option value={code}>{t(`languages.${code}`)}</option>
          {/each}
        </select>
        </span>
      </label>
      {#if onboarding.created}
        <p class="m-0 mt-2" style="font-size: 12px; color: var(--ok);">
          {t("onboarding.projectCreated")}
        </p>
      {/if}

    {:else if onboarding.step === "template"}
      <h3 class="v-section-title mb-2">{t("onboarding.step.template")}</h3>
      <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("onboarding.templateHint")}</p>
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        {#each TEMPLATES as template (template)}
          {@const chosen = onboarding.template === template}
          <li>
            <button
              class="v-list-item {chosen ? 'v-list-item-active' : ''}"
              aria-pressed={chosen}
              style="width: 100%; text-align: left;"
              onclick={() => choose(template)}
            >
              <span style="font-size: 13px;">{t(`onboarding.templates.${template}.name`)}</span>
              <span class="v-muted" style="font-size: 12px; margin-left: auto;">
                {t("onboarding.templateChapters", {
                  count: templateChapterKeys(template).length,
                })}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if titles.length > 0}
        <p class="v-muted m-0 mt-3" style="font-size: 12px;">
          {t("onboarding.templatePreview")}: {titles.join(" · ")}
        </p>
      {/if}

    {:else}
      <h3 class="v-section-title mb-2">{t("onboarding.step.firstScene")}</h3>
      <p class="m-0" style="font-size: 13px;">{t("onboarding.firstSceneBody")}</p>
      <p class="v-muted m-0 mt-2" style="font-size: 12px;">{t("onboarding.rewriteHint")}</p>
    {/if}

    {#if onboarding.error}
      <p role="alert" class="m-0 mt-3" style="font-size: 12.5px; color: var(--warn);">
        {onboarding.error}
      </p>
    {/if}

    {#if !isTauri()}
      <p class="v-muted m-0 mt-3" style="font-size: 12px;">{t("onboarding.none")}</p>
    {/if}
  </div>

  <div
    class="v-row flex-shrink-0"
    style="justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
  >
    <button class="v-btn" onclick={() => void close()}>{t("onboarding.skip")}</button>
    <span class="v-row" style="gap: 8px;">
      {#if onboarding.stepIndex > 0}
        <button class="v-btn" disabled={onboarding.busy} onclick={() => onboarding.back()}>
          {t("onboarding.back")}
        </button>
      {/if}
      {#if onboarding.step === "project" && !onboarding.created}
        <button
          class="v-btn v-btn-primary"
          disabled={onboarding.busy || !onboarding.canAdvance}
          onclick={() => void onboarding.createProject()}
        >
          {onboarding.busy ? t("onboarding.working") : t("onboarding.createProject")}
        </button>
      {:else if onboarding.step === "template"}
        <button
          class="v-btn v-btn-primary"
          disabled={onboarding.busy}
          onclick={() => void onboarding.applyTemplate(titles)}
        >
          {onboarding.busy ? t("onboarding.working") : t("onboarding.useTemplate")}
        </button>
      {:else if isLastStep(onboarding.step)}
        <button class="v-btn v-btn-primary" onclick={() => void done()}>
          {t("onboarding.start")}
        </button>
      {:else}
        <button
          class="v-btn v-btn-primary"
          disabled={onboarding.busy || !onboarding.canAdvance}
          onclick={() => onboarding.next()}
        >
          {t("onboarding.next")}
        </button>
      {/if}
    </span>
  </div>
</Modal>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
