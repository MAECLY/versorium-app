<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { isTauri } from "$lib/tauri";
  import { gpu } from "$lib/models/gpu.svelte";
  import GpuStatusDialog from "$lib/settings/models/GpuStatusDialog.svelte";

  /**
   * Where local AI does not run on a graphics card, the page says so, and
   * says why on request. Never silent: a model on the processor is several
   * times slower, and a writer who is not told blames the app. When nothing
   * can run, the modal opens by itself once per visit.
   */
  onMount(() => {
    if (!isTauri()) return;
    void gpu.load().then(() => gpu.offerOnce());
  });
</script>

{#if gpu.onCpu || gpu.unavailable}
  <div
    class="v-card mb-3 p-3"
    role="status"
    style="font-size: 12.5px; line-height: 1.6; border-left: 3px solid var(--warn);"
    data-gpu-notice={gpu.readiness?.state}
  >
    <span>{t(gpu.unavailable ? "gpu.notice.unavailable" : "gpu.notice.cpu")}</span>
    <button class="v-link" style="margin-left: 6px;" onclick={() => (gpu.open = true)}>{t("gpu.notice.see")}</button>
  </div>
{/if}

{#if gpu.open}
  <GpuStatusDialog onClose={() => (gpu.open = false)} />
{/if}
