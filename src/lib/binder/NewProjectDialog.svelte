<script lang="ts">
  import { store } from "$lib/binder/store.svelte";
  import { t, getLocale } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let title = $state("");
  let language = $state(getLocale());
  /** This dialog's own failure: an older one from elsewhere is not about this project. */
  let error = $state("");

  async function submit(): Promise<void> {
    if (!title.trim() || store.loading) return;
    const failed = await store.createProject(title, language);
    if (failed) error = failed;
    else onClose();
  }
</script>

<Modal label={t("dialog.newProject")} {onClose}>
  <form
    class="flex flex-col gap-4"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("dialog.newProject")}</h2>

    <label class="flex flex-col gap-1" style="font-size: 13px;">
      {t("dialog.title")}
      <input
        bind:value={title}
        placeholder={t("dialog.titlePlaceholder")}
        required
      />
    </label>

    <label class="flex flex-col gap-1" style="font-size: 13px;">
      {t("dialog.language")}
      <span class="v-select">
      <select bind:value={language}>
        <option value="es">{t("languages.es")}</option>
        <option value="en">{t("languages.en")}</option>
      </select>
      </span>
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
