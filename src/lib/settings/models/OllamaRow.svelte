<script lang="ts">
  import { t } from "$lib/i18n";
  import type { LocalAiView } from "$lib/tauri";
  import { models } from "$lib/models/state.svelte";
  import TextField from "$lib/components/forms/TextField.svelte";
  import ExpanderRow from "$lib/settings/ExpanderRow.svelte";

  /**
   * Ollama, as one row: whether it runs and how many models it serves, and,
   * opened, how to get one more. Its models themselves are listed with the
   * others, under Your models, because a writer choosing a model should not
   * have to know which program runs it.
   */
  let {
    view,
    open = $bindable(false),
    inUse,
  }: {
    view: LocalAiView;
    open?: boolean;
    /** A task points at Ollama, which turns a stopped daemon into a warning. */
    inUse: boolean;
  } = $props();

  let ollama = $derived(view.ollama);
  let name = $state("");

  let status = $derived(
    ollama.running
      ? ollama.models.length === 1
        ? t("settings.models.ollama.running.one")
        : t("settings.models.ollama.running.other", { count: ollama.models.length })
      : ollama.installed
        ? t("settings.models.ollama.stopped")
        : t("settings.models.ollama.missing"),
  );
  let tone = $derived<"ok" | "warn" | "mute">(ollama.running ? "ok" : inUse ? "warn" : "mute");

  async function get(): Promise<void> {
    const tag = name.trim();
    if (!tag || models.pulling !== null) return;
    await models.pullOllama(tag);
    if (!models.pullError) name = "";
  }
</script>

<ExpanderRow id="models-ollama" focusKey="models:ollama" title={t("settings.models.ollama.name")} {status} {tone} bind:open>
  <p class="v-muted m-0 mb-2" style="font-size: 12.5px; line-height: 1.6;">{t("settings.models.ollama.about")}</p>
  {#if ollama.running}
    <div class="v-row" style="gap: 8px; align-items: flex-end; flex-wrap: wrap;">
      <TextField
        label={t("settings.models.ollama.getLabel")}
        placeholder={t("settings.models.ollama.placeholder")}
        value={name}
        busy={models.pulling !== null}
        grow
        onInput={(next) => (name = next)}
        onSubmit={() => void get()}
      />
      <button class="v-btn" disabled={!name.trim() || models.pulling !== null} onclick={() => void get()}>
        {t("settings.models.ollama.get")}
      </button>
    </div>
  {:else if ollama.installed}
    <p class="m-0" style="font-size: 12.5px;">{t("settings.models.ollama.startIt")}</p>
  {:else}
    <p class="m-0" style="font-size: 12.5px;">{t("settings.models.ollama.install")}</p>
  {/if}
  <!-- Always in the DOM, so the words are read when they arrive. -->
  <p class="v-muted m-0 mt-2" style="font-size: 12px;" aria-live="polite">
    {models.pulling ? t("settings.models.ollama.getting", { name: models.pulling }) : ""}
  </p>
  {#if models.pullError}
    <p role="alert" class="m-0 mt-1" style="font-size: 12px; color: var(--warn);">{models.pullError}</p>
  {/if}
</ExpanderRow>
