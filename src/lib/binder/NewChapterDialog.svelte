<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";

  let {
    onClose,
    onCreated,
  }: {
    onClose: () => void;
    /** The new chapter is open, after the dialog has gone: a peek it came from closes on it. */
    onCreated?: () => void;
  } = $props();

  let title = $state("");
  /** This dialog's own failure: an older one from elsewhere is not about this chapter. */
  let error = $state("");

  async function submit(): Promise<void> {
    if (!title.trim() || store.loading) return;
    const failed = await store.createChapter(title);
    if (failed) {
      error = failed;
      return;
    }
    onClose();
    onCreated?.();
  }
</script>

<Modal label={t("dialog.newChapter")} {onClose}>
  <form
    class="flex flex-col gap-4"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("dialog.newChapter")}</h2>

    <label class="flex flex-col gap-1" style="font-size: 13px;">
      {t("dialog.chapterTitle")}
      <input bind:value={title} placeholder={t("dialog.chapterTitlePlaceholder")} required />
    </label>

    {#if error}<p role="alert" class="m-0">{error}</p>{/if}

    <div class="v-row justify-end" style="gap: 8px;">
      <button type="button" class="v-btn" onclick={onClose}>{t("dialog.cancel")}</button>
      <button type="submit" class="v-btn v-btn-primary" disabled={store.loading || !title.trim()}>
        {t("dialog.create")}
      </button>
    </div>
  </form>
</Modal>
