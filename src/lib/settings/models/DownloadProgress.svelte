<script lang="ts">
  import { t } from "$lib/i18n";
  import type { ModelCard } from "$lib/tauri";
  import { models, humanSize, percent } from "$lib/models/state.svelte";

  /**
   * A download in progress: a bar that moves, the bytes in words, and
   * Cancel. A real bar, not a number: a 3 GB file on a slow line moves a
   * percentage so rarely that the page read as frozen. The bar's value is
   * not announced as it moves; the start and the end of a download are.
   */
  let {
    model,
    onCancel = (id: string) => models.cancel(id),
  }: {
    model: ModelCard;
    /** Stop it; the caller may also move focus off the Cancel that goes with the bar. */
    onCancel?: (id: string) => Promise<void> | void;
  } = $props();

  let progress = $derived(models.view?.progress);
  let mine = $derived(progress?.id === model.id ? progress : null);
  let received = $derived(mine ? mine.received : model.receivedBytes);
  let total = $derived(mine && mine.total > 0 ? mine.total : model.sizeBytes);
  let done = $derived(percent(received, total));
</script>

<div class="v-row" style="gap: 10px; flex-wrap: wrap;">
  <div style="min-width: 200px; flex: 1;">
    <div
      role="progressbar"
      class="v-progress"
      aria-label={t("settings.models.available.downloading", { model: model.label })}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={done}
      aria-valuetext={t("settings.models.available.progressValue", {
        done: humanSize(received),
        total: humanSize(total),
      })}
    >
      <span style="width: {done}%;"></span>
    </div>
    <p class="v-muted m-0 mt-1" style="font-size: 11.5px; font-variant-numeric: tabular-nums;">
      {t("settings.models.available.progress", { done: humanSize(received), total: humanSize(total), percent: done })}
    </p>
  </div>
  <button class="v-btn" data-cancel onclick={() => void onCancel(model.id)}>{t("settings.models.available.cancel")}</button>
</div>
