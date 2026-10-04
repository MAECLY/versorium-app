<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import { languageOptions } from "$lib/i18n/languages";
  import { api, isTauri, type ExportFormat, type Imported } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { formats, bodyWords } from "$lib/formats/state.svelte";
  import { warningMessage } from "$lib/i18n/errors";
  import { humanSize } from "$lib/models/state.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Select from "$lib/components/forms/Select.svelte";

  let { onClose }: { onClose: () => void } = $props();

  type Tab = "export" | "import";
  const TABS: Tab[] = ["export", "import"];
  const FORMATS: ExportFormat[] = ["md", "docx", "epub", "pdf", "scriv"];
  /** Spec §9: these two print the surname in every running head. */
  const NEEDS_AUTHOR: ExportFormat[] = ["docx", "pdf"];

  let tab = $state<Tab>("export");
  let tabRefs: HTMLButtonElement[] = [];
  let format = $state<ExportFormat>("md");
  let author = $state("");
  let importTitle = $state("");
  /** The novel's language: the source's when it gives one a novel can take, else the interface's. */
  let importLanguage = $state("");

  let project = $derived(store.project);
  let missingAuthor = $derived(NEEDS_AUTHOR.includes(format) && author.trim() === "");
  let preview = $derived(formats.preview);

  onMount(() => {
    author = store.project?.meta.author ?? "";
    formats.clearResult();
  });

  // The preview names the project and may give its language; let the writer
  // change either before it exists. The interface's language is only a
  // preset, so a later switch of the interface does not move a pick. Before
  // the DOM updates, so the fields never show empty for a frame.
  $effect.pre(() => {
    const next = formats.preview;
    if (!next) return;
    importTitle = next.title;
    importLanguage = next.language ?? untrack(() => getLocale());
  });

  /** Where the preset came from, said under the picker: the file, or nowhere. */
  function languageHint(preview: Imported): string {
    if (preview.language) {
      return t("manuscript.import.languageFromSource", { language: t(`languages.${preview.language}`) });
    }
    if (preview.declaredLanguage) {
      return t("manuscript.import.languageUnsupported", { tag: preview.declaredLanguage });
    }
    return t("manuscript.import.languageAsk");
  }

  function selectTab(next: Tab): void {
    tab = next;
  }

  /** Arrow keys move between tabs, as a tablist is expected to. */
  function onTabKey(event: KeyboardEvent, index: number): void {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + TABS.length) % TABS.length;
    selectTab(TABS[next]);
    tabRefs[next]?.focus();
  }

  async function doExport(): Promise<void> {
    const path = project?.path;
    if (!path || missingAuthor) return;
    // Save the author first: the running head is read from the project, not
    // from this field, so an unsaved name would print as blank.
    const trimmed = author.trim();
    if (trimmed !== (project?.meta.author ?? "")) {
      try {
        await api.setAuthor(path, trimmed);
        await store.refreshProjects();
      } catch {
        // A failed save must not block an export that does not need the name.
      }
    }
    await formats.exportAs(path, format, project?.meta.title ?? "manuscript", project?.meta.language ?? "en");
  }

  async function doImport(): Promise<void> {
    const title = importTitle.trim();
    if (!title || !importLanguage) return;
    const path = await formats.applyImport(title, importLanguage);
    if (path) {
      await store.openProject(path);
      onClose();
    }
  }
</script>

<Modal label={t("manuscript.title")} {onClose} wide>
  <div class="v-row flex-shrink-0" style="justify-content: space-between;">
    <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("manuscript.title")}</h2>
    <button class="v-btn" style="padding: 2px 10px;" onclick={onClose} aria-label={t("manuscript.close")}>✕</button>
  </div>

  <div class="v-row mt-3 flex-shrink-0" style="gap: 4px;" role="tablist" aria-label={t("manuscript.title")}>
    {#each TABS as name, i (name)}
      <button
        bind:this={tabRefs[i]}
        class="v-btn"
        role="tab"
        id="manuscript-tab-{name}"
        aria-controls="manuscript-panel-{name}"
        aria-selected={tab === name}
        tabindex={tab === name ? 0 : -1}
        style="padding: 4px 12px; font-size: 12.5px; {tab === name
          ? 'background: var(--accent); color: var(--accent-contrast); border-color: var(--accent);'
          : ''}"
        onclick={() => selectTab(name)}
        onkeydown={(e) => onTabKey(e, i)}
      >
        {t(`manuscript.tabs.${name}`)}
      </button>
    {/each}
  </div>

  <!-- A scroll box clips at its edges, and the import's title and language
       fields span it: it reaches 4px into the dialog's padding and gives them
       back inside, room for a 3px focus ring with the layout unchanged. -->
  <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-4">
    {#if formats.error}
      <p role="alert" class="m-0 mb-3" style="font-size: 13px; color: var(--warn);">{formats.error}</p>
    {/if}

    <!-- Export -->
    <div
      id="manuscript-panel-export"
      role="tabpanel"
      aria-labelledby="manuscript-tab-export"
      hidden={tab !== "export"}
    >
      <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("manuscript.export.intro")}</p>

      <fieldset class="m-0 mb-3 p-0" style="border: 0;">
        <legend class="v-section-title mb-2" style="padding: 0;">{t("manuscript.export.format")}</legend>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          {#each FORMATS as name (name)}
            <li class="v-card p-3" style={format === name ? "border-color: var(--accent);" : ""}>
              <label class="v-row" style="gap: 8px; align-items: flex-start; cursor: pointer;">
                <input type="radio" name="export-format" value={name} bind:group={format} style="margin-top: 3px;" />
                <span style="min-width: 0;">
                  <b style="font-size: 13px;">{t(`manuscript.export.formatNames.${name}`)}</b>
                  <span class="v-muted" style="display: block; font-size: 12px; line-height: 1.5;">
                    {t(`manuscript.export.formats.${name}`)}
                  </span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
      </fieldset>

      <label class="flex flex-col gap-1" style="font-size: 13px;">
        {t("manuscript.export.author")}
        <input bind:value={author} placeholder={t("manuscript.export.authorPlaceholder")} />
      </label>
      <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("manuscript.export.authorHint")}</p>
      {#if missingAuthor}
        <p class="m-0 mt-1" style="font-size: 12px; color: var(--warn);">{t("manuscript.export.authorMissing")}</p>
      {/if}

      {#if formats.result}
        <p class="m-0 mt-3" style="font-size: 12.5px; color: var(--ok);" aria-live="polite">
          {t("manuscript.export.done", {
            size: humanSize(formats.result.bytes),
            path: formats.result.path,
          })}
        </p>
        {#if formats.result.warnings.length > 0}
          <p class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">
            {t("manuscript.export.warningsTitle")}
          </p>
          <ul class="m-0 mt-1 list-none p-0" style="font-size: 12px; color: var(--warn);">
            {#each formats.result.warnings as warning, index (index)}
              <li>{warningMessage(warning)}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <!-- Import -->
    <div
      id="manuscript-panel-import"
      role="tabpanel"
      aria-labelledby="manuscript-tab-import"
      hidden={tab !== "import"}
    >
      <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("manuscript.import.intro")}</p>

      {#if !preview}
        <div class="v-row" style="gap: 8px; flex-wrap: wrap;">
          <button class="v-btn" disabled={formats.busy} onclick={() => void formats.pickAndPreview("file")}>
            {t("manuscript.import.chooseFile")}
          </button>
          <button class="v-btn" disabled={formats.busy} onclick={() => void formats.pickAndPreview("project")}>
            {t("manuscript.import.chooseProject")}
          </button>
        </div>
        <p class="v-muted m-0 mt-2" style="font-size: 12px;">
          {t("manuscript.import.fileHint")} · {t("manuscript.import.projectHint")}
        </p>
      {:else}
        <label class="flex flex-col gap-1" style="font-size: 13px;">
          {t("manuscript.import.previewTitle")}
          <input bind:value={importTitle} />
        </label>

        <div class="mt-3">
          <Select
            label={t("dialog.language")}
            hint={languageHint(preview)}
            bind:value={importLanguage}
            options={languageOptions("")}
            minWidth="200px"
          />
        </div>

        <h4 class="v-section-title mb-1 mt-3">{t("manuscript.import.chapters")}</h4>
        {#if preview.chapters.length === 0}
          <p class="v-muted m-0" style="font-size: 13px;">{t("manuscript.import.noChapters")}</p>
        {:else}
          <ul class="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("manuscript.import.chapters")}>
            {#each preview.chapters as chapter, index (index)}
              <li class="v-row" style="justify-content: space-between; gap: 12px; font-size: 12.5px;">
                <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {chapter.title}
                </span>
                <span class="v-muted" style="flex-shrink: 0;">
                  {t("manuscript.import.chapterWords", { words: bodyWords(chapter.body) })}
                </span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if preview.warnings.length > 0}
          <h4 class="v-section-title mb-1 mt-3" style="color: var(--warn);">
            {t("manuscript.import.warningsTitle")}
          </h4>
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            {#each preview.warnings as warning, index (index)}
              <li style="font-size: 12px; color: var(--warn); line-height: 1.5;">
                {warningMessage(warning)}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>

  <div
    class="v-row flex-shrink-0"
    style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
  >
    {#if tab === "export"}
      <button
        class="v-btn v-btn-primary"
        disabled={formats.busy || missingAuthor || !isTauri()}
        onclick={() => void doExport()}
      >
        {formats.busy ? t("manuscript.export.busy") : t("manuscript.export.action")}
      </button>
    {:else if preview}
      <button class="v-btn" disabled={formats.busy} onclick={() => formats.discardPreview()}>
        {t("manuscript.import.cancel")}
      </button>
      <button
        class="v-btn v-btn-primary"
        disabled={formats.busy || importTitle.trim() === ""}
        onclick={() => void doImport()}
      >
        {formats.busy ? t("manuscript.import.busy") : t("manuscript.import.action")}
      </button>
    {/if}
  </div>
</Modal>
