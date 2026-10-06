<script lang="ts">
  import { t } from "$lib/i18n";
  import type { LocalAiView } from "$lib/tauri";
  import { models, humanSize } from "$lib/models/state.svelte";
  import { engine } from "$lib/models/engine.svelte";
  import { sizeWordKey } from "$lib/settings/ai/picks";
  import Disclosure from "$lib/settings/Disclosure.svelte";

  /**
   * One sentence about this computer, and the measurements behind it folded
   * away. Check again is the page's one refresh: it reads the models again
   * and asks the engine how it is.
   */
  let { view }: { view: LocalAiView } = $props();

  let hardware = $derived(view.hardware);
  let known = $derived(hardware.totalRamGb > 0);

  /** The device the engine reports once it is up, else what the hardware probe said. */
  let graphics = $derived.by(() => {
    const device = engine.state?.device?.label;
    if (device) return device;
    if (hardware.gpu === "hardware_gpu_pending" || !hardware.gpu) return t("settings.models.engine.warming");
    return hardware.gpu;
  });

  let engineWord = $derived(
    engine.warming
      ? t("settings.models.engine.warming")
      : engine.unavailable
        ? t("settings.models.engine.unavailable")
        : engine.failed
        ? t("settings.models.engine.failed")
        : t("settings.models.engine.ready"),
  );

  function checkAgain(): void {
    void models.load();
    void engine.poll();
  }
</script>

<p class="m-0 mb-2" style="font-size: 13px; line-height: 1.6;">
  {known
    ? t("settings.models.thisComputer", {
        ram: `${Math.round(hardware.totalRamGb)} GB`,
        size: t(sizeWordKey(hardware.recommendedTier)),
      })
    : t("settings.models.thisComputerUnknown")}
</p>

<Disclosure key="models:about" label={t("settings.models.about.title")}>
  {#snippet trailing()}
    <button class="v-btn" style="padding: 2px 10px; font-size: 12px;" disabled={models.loading} onclick={checkAgain}>
      {models.loading ? t("settings.common.checking") : t("settings.common.checkAgain")}
    </button>
  {/snippet}
  <dl class="v-facts m-0" style="font-size: 12.5px; line-height: 1.7;">
    <dt>{t("settings.models.about.memory")}</dt>
    <dd>{known ? `${hardware.totalRamGb.toFixed(1)} GB` : "—"}</dd>
    <dt>{t("settings.models.about.cores")}</dt>
    <dd>{hardware.cpuCores}</dd>
    <dt>{t("settings.models.about.system")}</dt>
    <dd>{hardware.os}/{hardware.arch}</dd>
    <dt>{t("settings.models.about.graphics")}</dt>
    <dd>{graphics}</dd>
    <dt>{t("settings.models.about.engine")}</dt>
    <dd aria-live="polite" style={engine.failed || engine.unavailable ? "color: var(--warn);" : ""}>{engineWord}</dd>
  </dl>
  {#if engine.state && engine.state.state === "ready" && !engine.state.gpuOffload}
    <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("settings.models.engine.cpuOnly")}</p>
  {/if}
  <p class="v-muted m-0 mt-2" style="font-size: 12px; line-height: 1.6;">
    {t("settings.models.about.disk", { size: humanSize(view.diskUsedBytes) })}
    {t("settings.models.about.folder")}:
    <span class="v-mono-select">{view.modelsDir}</span>
  </p>
</Disclosure>
