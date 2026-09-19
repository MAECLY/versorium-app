<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let title = $state("");

  async function submit(): Promise<void> {
    if (!title.trim() || store.loading) return;
    await store.createChapter(title);
    if (!store.error) onClose();
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

    {#if store.error}<p role="alert" class="m-0">{store.error}</p>{/if}

    <div class="v-row justify-end" style="gap: 8px;">
      <button type="button" class="v-btn" onclick={onClose}>{t("dialog.cancel")}</button>
      <button type="submit" class="v-btn v-btn-primary" disabled={store.loading || !title.trim()}>
        {t("dialog.create")}
      </button>
    </div>
  </form>
</Modal>
