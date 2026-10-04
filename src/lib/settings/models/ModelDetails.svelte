<script lang="ts">
  import { t, getLocale } from "$lib/i18n";
  import type { ModelCard } from "$lib/tauri";
  import Disclosure from "$lib/settings/Disclosure.svelte";

  /** What a model is beyond its row, in plain words, folded until asked for. */
  let { model }: { model: ModelCard } = $props();
</script>

<Disclosure key="models:details:{model.id}" label={t("settings.models.details.button")}>
  <div class="v-muted" style="font-size: 12px; line-height: 1.65;">
    <p class="m-0">{t(`settings.models.tierNote.${model.tier}`)}</p>
    <p class="m-0">
      {t("settings.models.details.speedQuality", {
        speed: t(`settings.models.speed.${model.speed}`),
        quality: t(`settings.models.quality.${model.quality}`),
      })}
    </p>
    <p class="m-0">{t("settings.models.details.memory", { ram: `${model.ramHintGB} GB` })}</p>
    <p class="m-0">{t("settings.models.details.quant", { quant: model.quant })}</p>
    <p class="m-0">{t("settings.models.details.context", { ctx: model.ctx.toLocaleString(getLocale()) })}</p>
    <p class="m-0">{t("settings.models.details.source", { license: model.license, repo: model.repo })}</p>
    {#if model.uncensored}
      <p class="m-0">{t("settings.models.available.uncensoredWhy")}</p>
    {/if}
  </div>
</Disclosure>
