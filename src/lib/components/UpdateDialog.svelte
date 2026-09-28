<script lang="ts">
  import { t, getLocale } from "$lib/i18n";
  import { updates } from "$lib/update/state.svelte";
  import Modal from "$lib/components/Modal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let available = $derived(updates.available);
  let current = $derived(updates.status?.currentVersion ?? "");

  function released(when: string): string {
    const date = new Date(when);
    return Number.isNaN(date.getTime()) ? when : date.toLocaleDateString(getLocale());
  }

  async function doSkip(): Promise<void> {
    await updates.skip();
    onClose();
  }
</script>

<Modal label={t("updates.dialog.title")} {onClose} wide>
  <div class="v-row flex-shrink-0" style="justify-content: space-between;">
    <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("updates.dialog.title")}</h2>
  </div>

  {#if available}
    <div class="min-h-0 flex-1 overflow-y-auto py-4">
      <p class="m-0" style="font-size: 14px; font-weight: 600;">
        {t("updates.dialog.heading", { version: available.version })}
      </p>
      <p class="v-muted m-0 mt-1" style="font-size: 12px;">
        {t("updates.dialog.from", { version: current })}
        {#if available.date}
          · {t("updates.dialog.released", { date: released(available.date) })}
        {/if}
      </p>

      <h3 class="v-section-title mb-1 mt-3">{t("updates.dialog.notes")}</h3>
      <!-- Plain text on purpose: a release body is remote content and must not
           be able to execute anything here. -->
      {#if available.notes.trim()}
        <p
          class="v-card m-0 overflow-y-auto p-3"
          style="max-height: 40vh; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;"
        >{available.notes}</p>
      {:else}
        <p class="v-muted m-0" style="font-size: 12.5px;">{t("updates.dialog.noNotes")}</p>
      {/if}

      <p class="v-muted m-0 mt-3" style="font-size: 11.5px;">{t("updates.dialog.verified")}</p>

      {#if updates.error}
        <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">
          {updates.error}
        </p>
      {/if}
    </div>

    <div
      class="v-row flex-shrink-0"
      style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
    >
      <button class="v-btn" disabled={updates.busy} onclick={() => void doSkip()}>
        {t("updates.dialog.skip")}
      </button>
      <button class="v-btn" disabled={updates.busy} onclick={onClose}>
        {t("updates.dialog.later")}
      </button>
      <button
        class="v-btn v-btn-primary"
        disabled={updates.busy}
        onclick={() => void updates.install()}
      >
        {updates.busy ? t("updates.dialog.installing") : t("updates.dialog.install")}
      </button>
    </div>
  {/if}
</Modal>
