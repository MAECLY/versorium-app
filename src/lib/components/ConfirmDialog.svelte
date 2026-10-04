<script lang="ts">
  import { t } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";

  /**
   * A confirmation, and what follows from saying yes.
   *
   * For a destructive action, `body` says what the recovery is rather than
   * asking "are you sure": a writer deleting a chapter is helped by "it stays
   * in this novel's history" and not at all by being asked twice.
   *
   * A grant is the other kind (Access to your novel › Allow writing…): it
   * gives something away rather than destroying it, so its confirm is a plain
   * button (`tone="neutral"`), the safe answer is the one focus starts on and
   * can say what it keeps (`cancelLabel`), and the dialog is an alert, read
   * out with its first paragraph (`alert`, `body` as paragraphs).
   */
  let {
    title,
    body,
    confirmLabel,
    cancelLabel,
    tone = "warn",
    alert = false,
    onCancel,
    onConfirm,
  }: {
    title: string;
    /** One paragraph, or several; the first describes the dialog. */
    body: string | readonly string[];
    confirmLabel: string;
    /** The safe answer, named for what it keeps. Defaults to "Cancel". */
    cancelLabel?: string;
    /** `warn` fills the confirm with --warn (a deletion); `neutral` leaves it plain. */
    tone?: "warn" | "neutral";
    /** An alertdialog: the decision interrupts, and is announced as one. */
    alert?: boolean;
    onCancel: () => void;
    onConfirm: () => Promise<void> | void;
  } = $props();

  const uid = $props.id();
  const describedBy = `${uid}-body`;

  let paragraphs = $derived(typeof body === "string" ? [body] : body);
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

<Modal label={title} onClose={onCancel} role={alert ? "alertdialog" : "dialog"} {describedBy}>
  <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{title}</h2>
  {#each paragraphs as paragraph, index (index)}
    <p id={index === 0 ? describedBy : undefined} class="m-0 mt-2" style="font-size: 13px; line-height: 1.6;">
      {paragraph}
    </p>
  {/each}

  <div
    class="v-row mt-4"
    style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
  >
    <!-- showModal() already focuses the first focusable element, which is
         this one; the attribute makes the safe answer the start on purpose
         rather than by position. The dialog it opens in is Modal's, so the
         rule cannot see that it is inside one. -->
    <!-- svelte-ignore a11y_autofocus -->
    <button class="v-btn" onclick={onCancel} disabled={busy} autofocus>{cancelLabel ?? t("dialog.cancel")}</button>
    <button
      class="v-btn"
      data-tone={tone}
      style={tone === "warn"
        ? "background: var(--warn); color: var(--accent-contrast); border-color: var(--warn);"
        : undefined}
      onclick={() => void confirm()}
      disabled={busy}
    >
      {confirmLabel}
    </button>
  </div>
</Modal>
