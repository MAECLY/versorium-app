<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { isTauri } from "$lib/tauri";
  import { warningMessage } from "$lib/i18n/errors";
  import { store } from "$lib/binder/store.svelte";
  import { models } from "$lib/models/state.svelte";
  import { continuityRunner as runner } from "$lib/continuity/state.svelte";
  import type { SettingsTarget } from "$lib/settings/pages";

  /**
   * Manuscript › Continuity: the check, where the manuscript is.
   *
   * It used to live in Settings, beside the model choice, which made a thing
   * a writer does to a novel into a setting. Settings keeps the choice; this
   * says which model runs it and links back there. The button that starts it
   * is the dialog's primary action, in its footer.
   */
  let {
    chosen,
    active,
    onOpenSettings,
  }: {
    /** The model Continuity runs on, as the writer knows it; null when none is chosen. */
    chosen: { label: string; remote: string | null } | null;
    /** The tab is the one shown. */
    active: boolean;
    onOpenSettings?: (target: SettingsTarget) => void;
  } = $props();

  /** Where Settings lets the writer choose. */
  const CHOOSE: SettingsTarget = { page: "tasks", focus: "continuity" };

  // A fresh dialog shows no result from another visit, or another novel.
  onMount(() => runner.reset());

  // Read afresh the first time the tab is shown in a visit, since the model
  // chosen may have changed (or gone) since Settings last read it. Not when
  // the dialog opens on Export: reading the models asks Ollama and the saved
  // server, which an export has no use for.
  let opened = false;
  $effect(() => {
    if (!active || opened || !isTauri()) return;
    opened = true;
    void models.open();
  });
  onDestroy(() => {
    if (opened) models.close();
  });

  /**
   * A finding names a chapter by its id (`ch-02`), the way the check sent it
   * to the model; the writer knows it by its title. The id stays when the
   * novel has no such chapter.
   */
  function chapterName(id: string): string {
    const chapters = store.project?.chapters ?? [];
    const number = (value: string) => (/^ch-\d+$/.test(value) ? Number(value.slice(3)) : NaN);
    const found = chapters.find((c) => c.id === id) ?? chapters.find((c) => number(c.id) === number(id));
    return found?.title || id;
  }
</script>

<p class="v-muted m-0 mb-3" style="font-size: 12px; line-height: 1.6;">{t("continuity.hint")}</p>

{#if !isTauri()}
  <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.none")}</p>
{:else}
  {#if !models.view}
    <p class="v-muted m-0" style="font-size: 13px;">{t("agents.checking")}</p>
  {:else if chosen}
    <p class="m-0" style="font-size: 13px; line-height: 1.6;">
      {chosen.remote
        ? t("continuity.runsOnRemote", { model: chosen.label, address: chosen.remote })
        : t("continuity.runsOn", { model: chosen.label })}
      <button class="v-link" onclick={() => onOpenSettings?.(CHOOSE)}>{t("continuity.change")}</button>
    </p>
  {:else}
    <p class="m-0" style="font-size: 13px; line-height: 1.6;">
      {t("continuity.noModel")}
      <button class="v-link" onclick={() => onOpenSettings?.(CHOOSE)}>{t("continuity.choose")}</button>
    </p>
  {/if}

  {#if !store.project}
    <p class="v-muted m-0 mt-2" style="font-size: 13px;">{t("continuity.noProject")}</p>
  {/if}

  <!-- The result of the last check, announced when it arrives. -->
  <div class="mt-3" aria-live="polite" aria-busy={runner.busy}>
    {#if runner.report}
      {#if !runner.report.ran}
        <p class="m-0" style="font-size: 12.5px; color: var(--warn);">
          {warningMessage(runner.report.reason ?? "continuity_failed")}
        </p>
      {:else if runner.report.findings.length === 0}
        <p class="v-muted m-0" style="font-size: 13px;">{t("continuity.clean")}</p>
      {:else}
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          {#each runner.report.findings as finding, index (index)}
            <li class="v-card p-2" style="font-size: 12.5px;">
              <!-- Rust sends a code, `contradiction` or `note`; it was shown raw. -->
              <b>{t(`continuity.kinds.${finding.kind}`)}</b>
              {#if finding.chapter}
                <span class="v-muted" style="font-size: 11px;"> · {chapterName(finding.chapter)}</span>
              {/if}
              <p class="m-0 mt-1">{finding.detail}</p>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  {#if runner.error}
    <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{runner.error}</p>
  {/if}
{/if}
