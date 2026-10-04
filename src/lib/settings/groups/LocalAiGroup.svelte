<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type ContinuityReport } from "$lib/tauri";
  import { errorMessage, warningMessage } from "$lib/i18n/errors";
  import { store } from "$lib/binder/store.svelte";
  import { notices } from "$lib/notices/state.svelte";
  import LocalAiSection from "$lib/settings/LocalAiSection.svelte";

  // Continuity (M7): it only runs when a local model is assigned to the
  // Continuity slot, which is why it belongs beside the slots and not in a
  // section of its own.
  let report = $state<ContinuityReport | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function run(): Promise<void> {
    const path = store.project?.path;
    if (!path || busy) return;
    busy = true;
    error = null;
    try {
      report = await api.continuityCheck(path);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  // Which models the catalogue is willing to show. It gates a model list, so
  // it lives with the models rather than under a separate "Safety" heading.
  let censorship = $state(false);

  async function setCensorship(on: boolean): Promise<void> {
    censorship = on;
    if (!isTauri()) return;
    try {
      await api.setSettings({ censorship: on });
      notices.dismiss("settings.censorship");
    } catch (e) {
      notices.fail(store.codeMessagePublic(e), "settings.censorship");
    }
  }

  onMount(() => {
    if (!isTauri()) return;
    api
      .getSettings()
      .then((s) => (censorship = s.censorship))
      .catch(() => {});
  });
</script>

<LocalAiSection />

<section class="mb-6" aria-label={t("safety.title")}>
  <h3 class="v-section-title mb-2">{t("safety.title")}</h3>
  <label class="v-row" style="gap: 8px; font-size: 13px;">
    <input
      type="checkbox"
      checked={censorship}
      onchange={(e) => void setCensorship((e.currentTarget as HTMLInputElement).checked)}
    />
    {t("safety.censorship")}
    <span class="v-muted" style="font-size: 12px;">— {censorship ? t("safety.on") : t("safety.off")}</span>
  </label>
  <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("safety.censorshipHint")}</p>
</section>

<section class="mb-6" aria-label={t("continuity.title")}>
  <div class="v-row mb-2" style="justify-content: space-between;">
    <h3 class="v-section-title m-0">{t("continuity.title")}</h3>
    {#if isTauri()}
      <button
        class="v-btn"
        style="padding: 2px 10px; font-size: 12px;"
        disabled={busy || !store.project}
        onclick={() => void run()}
      >
        {busy ? t("continuity.running") : t("continuity.run")}
      </button>
    {/if}
  </div>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("continuity.hint")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.none")}</p>
  {:else if !store.project}
    <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.noProject")}</p>
  {:else if report}
    {#if !report.ran}
      <p class="m-0" style="font-size: 12.5px; color: var(--warn);">
        {warningMessage(report.reason ?? "continuity_failed")}
      </p>
    {:else if report.findings.length === 0}
      <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.clean")}</p>
    {:else}
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        {#each report.findings as finding, index (index)}
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

  {#if error}
    <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{error}</p>
  {/if}
</section>
