<script lang="ts">
  import { t } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";

  /**
   * Rename a novel or a chapter.
   *
   * The copy says plainly that the folder or the file does not move, because
   * that is the question somebody renaming a thing in a writing app will
   * actually have: "will this break my backup / my links / my git history".
   */
  let {
    kind,
    current,
    onClose,
    onRename,
  }: {
    kind: "project" | "chapter";
    current: string;
    onClose: () => void;
    onRename: (title: string) => Promise<void>;
  } = $props();

  // svelte-ignore state_referenced_locally
  let title = $state(current);
  let busy = $state(false);

  let valid = $derived(title.trim().length > 0 && title.trim() !== current);

  async function submit(): Promise<void> {
    if (!valid || busy) return;
    busy = true;
    try {
      await onRename(title.trim());
      onClose();
    } finally {
      busy = false;
    }
  }
</script>

<Modal label={t(`binder.rename.${kind}`)} {onClose}>
  <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t(`binder.rename.${kind}`)}</h2>

  <label class="mt-3 flex flex-col gap-1" style="font-size: 13px;">
    {t("binder.rename.label")}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      autofocus
      bind:value={title}
      onkeydown={(e) => {
        if (e.key === "Enter") void submit();
      }}
    />
  </label>
  <p class="v-muted m-0 mt-2" style="font-size: 12px; line-height: 1.6;">
    {t(`binder.rename.${kind}Hint`)}
  </p>

  <div
    class="v-row mt-4"
    style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
  >
    <button class="v-btn" onclick={onClose} disabled={busy}>{t("dialog.cancel")}</button>
    <button class="v-btn v-btn-primary" onclick={() => void submit()} disabled={!valid || busy}>
      {t("binder.rename.action")}
    </button>
  </div>
</Modal>
