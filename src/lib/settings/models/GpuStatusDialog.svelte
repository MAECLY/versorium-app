<script lang="ts">
  import { t } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { gpu } from "$lib/models/gpu.svelte";
  import { shortAddress } from "$lib/about";

  let { onClose }: { onClose: () => void } = $props();

  let r = $derived(gpu.readiness);
  let title = $derived(r ? t(`gpu.title.${r.state}`) : t("gpu.title.checking"));
  /** Said once a Check again lands, so a screen reader hears what changed. */
  let announced = $state("");
  let failedToOpen = $state<string | null>(null);

  async function checkAgain(): Promise<void> {
    announced = "";
    await gpu.checkAgain();
    if (gpu.readiness) announced = t(`gpu.result.${gpu.readiness.state}`);
  }

  function vendorName(vendor: string): string {
    const key = `gpu.vendors.${vendor}`;
    const name = t(key);
    return name === key ? vendor : name;
  }
</script>

<Modal label={title} {onClose}>
  <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{title}</h2>
  {#if r}
    <p class="m-0 mt-2" style="font-size: 13px; line-height: 1.6;">{t(`gpu.lead.${r.state}`)}</p>

    <section class="mt-4" aria-labelledby="gpu-has-title">
      <h3 id="gpu-has-title" class="v-h3 m-0 mb-2">{t("gpu.has")}</h3>
      {#if r.gpus.length === 0}
        <p class="v-muted m-0" style="font-size: 12.5px;">{t(r.backend === "metal" ? "gpu.metal" : "gpu.noAdapters")}</p>
      {:else}
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          {#each r.gpus as card (card.name)}
            <li class="v-card p-2" style="font-size: 12.5px; line-height: 1.6;">
              <b>{card.name}</b>
              <span class="v-muted"> · {vendorName(card.vendor)}</span>
              <div class="v-muted">
                {card.driver ? t("gpu.driverVersion", { version: card.driver }) : t("gpu.noDriver")}
                · {card.vulkan ? t("gpu.vulkanVersion", { version: card.vulkan }) : t("gpu.noVulkan")}
              </div>
              <!-- Words, not a colour alone: whether models run on it. -->
              <div style={card.usable ? "color: var(--ok);" : ""}>{t(card.usable ? "gpu.usable" : "gpu.notUsable")}</div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if r.missing.length > 0}
      <section class="mt-4" aria-labelledby="gpu-missing-title">
        <h3 id="gpu-missing-title" class="v-h3 m-0 mb-2">{t("gpu.missingTitle")}</h3>
        <ul class="m-0 pl-4" style="font-size: 12.5px; line-height: 1.7;">
          {#each r.missing as code (code)}
            <li>{t(`gpu.missing.${code}`)}</li>
          {/each}
        </ul>
        {#if r.driver}
          <p class="m-0 mt-2" style="font-size: 12.5px;">
            <ExternalLink
              href={r.driver.url}
              where={shortAddress(r.driver.url)}
              onopen={() => (failedToOpen = null)}
              onfail={() => (failedToOpen = r?.driver?.url ?? null)}
            >{t("gpu.getDriver", { vendor: vendorName(r.driver.vendor) })}</ExternalLink>
          </p>
          {#if failedToOpen}
            <p role="alert" class="m-0 mt-1" style="font-size: 12px; color: var(--warn);">
              {t("links.openFailed")} <span class="v-mono-select">{failedToOpen}</span>
            </p>
          {/if}
        {/if}
        <p class="v-muted m-0 mt-2" style="font-size: 12px; line-height: 1.6;">{t("gpu.afterInstall")}</p>
      </section>
    {/if}

    {#each r.hints as hint (hint)}
      <p class="v-muted m-0 mt-2" style="font-size: 12px; line-height: 1.6;">{t(`gpu.hints.${hint}`)}</p>
    {/each}
  {:else}
    <p class="v-muted m-0 mt-2" style="font-size: 13px;">{t("gpu.lead.checking")}</p>
  {/if}

  {#if gpu.error}<p role="alert" class="m-0 mt-3" style="font-size: 12px; color: var(--warn);">{gpu.error}</p>{/if}
  <p class="m-0 mt-2" aria-live="polite" style="font-size: 12px;">{announced}</p>

  <div class="v-row mt-4" style="justify-content: flex-end; gap: 8px;">
    <button class="v-btn" onclick={onClose}>{t("gpu.close")}</button>
    <button class="v-btn v-btn-primary" disabled={gpu.checking} onclick={() => void checkAgain()}>
      {gpu.checking ? t("gpu.checking") : t("gpu.checkAgain")}
    </button>
  </div>
</Modal>
