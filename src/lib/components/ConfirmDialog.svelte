<script lang="ts">
  import { t } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";

  /**
   * A destructive action, and where the thing goes.
   *
   * `body` is expected to say what the recovery is, not to ask "are you sure".
   * A writer deleting a chapter is helped by "it stays in this novel's history"
   * and not at all by being asked twice.
   */
  let {
    title,
    body,
    confirmLabel,
    onCancel,
    onConfirm,
  }: {
    title: string;
    body: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => Promise<void> | void;
  } = $props();

  let busy = $state(false);

  async function confirm(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await onConfirm();
    } finally {
      busy = false;
    }
  }
</script>

<Modal label={title} onClose={onCancel}>
  <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{title}</h2>
  <p class="m-0 mt-2" style="font-size: 13px; line-height: 1.6;">{body}</p>

  <div
    class="v-row mt-4"
    style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
  >
    <button class="v-btn" onclick={onCancel} disabled={busy}>{t("dialog.cancel")}</button>
    <button
      class="v-btn"
      style="background: var(--warn); color: var(--accent-contrast); border-color: var(--warn);"
      onclick={() => void confirm()}
      disabled={busy}
    >
      {confirmLabel}
    </button>
  </div>
</Modal>
