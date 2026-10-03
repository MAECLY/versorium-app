<script lang="ts">
  import { t, getLocale } from "$lib/i18n";
  import { updates } from "$lib/update/state.svelte";
  import Modal from "$lib/components/Modal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let available = $derived(updates.available);
  let current = $derived(updates.status?.currentVersion ?? "");
  let progress = $derived(updates.progress);
  /** Installed and waiting: the only state where the writer must act again. */
  let ready = $derived(progress?.phase === "ready");

  /** Null when the server sent no length — an indeterminate bar, not 0%. */
  let percent = $derived.by(() => {
    const p = progress;
    if (!p || !p.total || p.total <= 0) return null;
    return Math.min(100, Math.round((p.received / p.total) * 100));
  });

  function megabytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(1);
  }

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

      {#if progress && progress.phase !== "failed"}
        <div class="v-card mt-3 p-3" aria-live="polite">
          <p class="m-0" style="font-size: 12.5px; font-weight: 600;">
            {t(`updates.phase.${progress.phase}`)}
          </p>

          {#if progress.phase === "downloading"}
            <!-- A bar only when a length is known; otherwise the byte count is
                 the honest signal and a bar would invent a denominator. -->
            {#if percent !== null}
              <div
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin="0"
                aria-valuemax="100"
                style="height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; margin-top: 8px;"
              >
                <div style="height: 100%; width: {percent}%; background: var(--accent);"></div>
              </div>
              <p class="v-muted m-0 mt-1" style="font-size: 11.5px; font-variant-numeric: tabular-nums;">
                {t("updates.phase.bytes", {
                  received: megabytes(progress.received),
                  total: megabytes(progress.total ?? 0),
                })}
              </p>
            {:else}
              <p class="v-muted m-0 mt-1" style="font-size: 11.5px; font-variant-numeric: tabular-nums;">
                {t("updates.phase.bytesUnknown", { received: megabytes(progress.received) })}
              </p>
            {/if}
          {/if}

          {#if ready}
            <p class="v-muted m-0 mt-1" style="font-size: 11.5px;">{t("updates.phase.readyHint")}</p>
          {/if}
        </div>
      {/if}

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
      {#if ready}
        <!-- Installed already. Skipping or postponing now would be a lie: the
             new version is on disk either way. -->
        <button class="v-btn v-btn-primary" onclick={() => void updates.relaunch()}>
          {t("updates.dialog.restart")}
        </button>
      {:else}
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
      {/if}
    </div>
  {/if}
</Modal>
