<script lang="ts">
  import { t, localeOf } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";
  import CoverPreview from "$lib/components/CoverPreview.svelte";
  import Checkbox from "$lib/components/forms/Checkbox.svelte";
  import Select from "$lib/components/forms/Select.svelte";
  import { languageOptions, novelLanguageOf } from "$lib/i18n/languages";
  import { exportLabels } from "$lib/formats/state.svelte";
  import { store } from "$lib/binder/store.svelte";
  import { api, isTauri, type AuthorProfile, type Project } from "$lib/tauri";

  /**
   * Settings that belong to this novel rather than to the app.
   *
   * They live in versorium.json and travel with the folder, which is the whole
   * reason they are not in Settings: copy the novel to another machine and its
   * title page comes with it.
   */
  let { path, onClose }: { path: string; onClose: () => void } = $props();

  // Read live from the store rather than taking a snapshot: a copy handed in as
  // a prop stops matching the file the moment a toggle is saved, and the
  // checkbox silently springs back.
  let project = $derived<Project | null>(
    store.projects.find((p) => p.path === path) ?? (store.project?.path === path ? store.project : null),
  );

  // Derived, not copied. These are stored in versorium.json and the store
  // replaces the project on every write, so a local copy would drift from the
  // file the moment a save came back.
  let cover = $derived(project?.meta.exportCover ?? true);
  let colophon = $derived(project?.meta.exportColophon ?? true);
  let profile = $state<AuthorProfile | null>(null);

  $effect(() => {
    if (!isTauri()) return;
    void api
      .getSettings()
      .then((s) => {
        profile = s.authorProfile === "hobby" ? s.authorProfiles.hobby : s.authorProfiles.work;
      })
      .catch(() => {});
  });

  // The project's own author wins, exactly as the exporter decides it.
  let byline = $derived(project?.meta.author.trim() || profile?.name.trim() || "");

  /**
   * Why a box's last change did not stick, said under that box: a notice
   * would sit behind this dialog's backdrop, unread. The box itself springs
   * back (Checkbox is strictly controlled).
   */
  let errors = $state<{ cover: string; colophon: string }>({ cover: "", colophon: "" });

  async function save(next: { cover?: boolean; colophon?: boolean }): Promise<void> {
    const which = next.cover === undefined ? "colophon" : "cover";
    const failed = await store.setExportMatter(path, next.cover ?? cover, next.colophon ?? colophon);
    errors = { ...errors, [which]: failed ?? "" };
  }

  let language = $derived(project?.meta.language ?? "");
  /**
   * What the picker shows. Bound, and overridden by the writer's pick until
   * the store answers: an unbound Select keeps a pick the backend refused, so
   * a failure puts this back by hand, and the error says why under the field.
   */
  let chosenLanguage = $derived(language);
  let languageError = $state("");
  /** The writer's latest pick while a change is being written; null when none is. */
  let wanted: string | null = null;

  /**
   * Write the writer's pick, one change at a time. A pick made while one is
   * being written waits for it, then goes, so the last choice is the one that
   * sticks and two writes to versorium.json never overlap. The picker stays
   * usable meanwhile: disabling a focused control would drop the focus.
   */
  async function chooseLanguage(next: string): Promise<void> {
    const writing = wanted !== null;
    wanted = next;
    if (writing) return;
    while (wanted !== null) {
      const next: string = wanted;
      // Rust stores the cleaned code (es-MX is kept as es), so "already the
      // novel's language" is judged on that, or a regional pick never matches.
      if (next === language || novelLanguageOf(next) === language) break;
      const failed = await store.setProjectLanguage(path, next);
      languageError = failed ?? "";
      if (failed) {
        chosenLanguage = language;
        break;
      }
      // Nothing new picked while that write ran: done. Comparing with what
      // came back instead loops forever on a code Rust cleans up.
      if (wanted === next) break;
      // The answer just reset the picker to what was written; a later pick
      // still waiting is what the writer last saw there, and goes next.
      if (wanted !== language) chosenLanguage = wanted;
    }
    wanted = null;
  }

  let words = $derived(project?.chapters.reduce((total, c) => total + c.words, 0) ?? 0);
  /** The closing page's wording, in the novel's language, as the export writes it. */
  let labels = $derived(exportLabels(language));
</script>

<Modal label={t("project.title")} {onClose} wide>
  <h2 class="m-0 flex-shrink-0" style="font-size: 16px; font-weight: 600;">{t("project.title")}</h2>
  <p class="v-muted m-0 mt-1 flex-shrink-0" style="font-size: 12px; line-height: 1.6;">{t("project.intro")}</p>

  <!-- Only this part scrolls, as in the other dialogs: on a laptop screen the
       settings outgrow the dialog (by 62px at 1280×800 in Spanish), and Done
       went below its edge. A scroll box clips at its edges, and the picker
       reaches the right one, so the box reaches 4px into the dialog's padding
       and gives them back inside: room for the 3px focus ring, same layout. -->
  <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-4">
    <!-- The preview is the point: a setting whose effect you can see is a
         setting you can decide about. -->
    <div class="v-row" style="gap: 20px; align-items: flex-start; flex-wrap: wrap;">
      <div>
        <p class="v-section-title m-0 mb-1">{t("project.preview")}</p>
        <CoverPreview
          title={project?.meta.title ?? ""}
          author={byline}
          organization={profile?.organization ?? ""}
          rights={profile?.rights ?? ""}
          dimmed={!cover}
        />
        {#if !byline}
          <p class="v-muted m-0 mt-1" style="font-size: 11px; max-width: 200px; line-height: 1.5;">
            {t("project.previewEmpty")}
          </p>
        {/if}
      </div>

      <div style="flex: 1; min-width: 260px;">
        <div class="mb-4">
          <Select
            label={t("dialog.language")}
            hint={t("project.languageHint")}
            error={languageError}
            bind:value={chosenLanguage}
            options={languageOptions(language)}
            minWidth="200px"
            onChange={(next) => void chooseLanguage(next)}
          />
        </div>

        <Checkbox
          label={t("project.coverLabel")}
          hint={t("project.coverHint")}
          error={errors.cover}
          checked={cover}
          onChange={(next) => void save({ cover: next })}
        />

        <div class="mt-3">
          <Checkbox
            label={t("project.colophonLabel")}
            hint={t("project.colophonHint")}
            error={errors.colophon}
            checked={colophon}
            onChange={(next) => void save({ colophon: next })}
          />
        </div>

        {#if colophon}
          <!-- What the last page will actually say, from this novel's own data
               and in its language, so it follows the picker above. The
               language row is the code, as `colophon_lines` writes it. -->
          <div class="v-card mt-3 p-3" lang={localeOf(language)} style="font-size: 11.5px; line-height: 1.7;">
            <b>{labels.heading}</b>
            <div>{labels.title}: {project?.meta.title}</div>
            {#if byline}<div>{labels.author}: {byline}</div>{/if}
            <div>{labels.language}: {language}</div>
            <div>{labels.chapters}: {project?.chapters.length ?? 0}</div>
            <!-- Bare digits, as the export writes the count: grouped by the
                 interface's locale, 12,345 reads as a decimal in a Spanish card. -->
            <div>{labels.words}: {words}</div>
            <div class="v-muted mt-1">{labels.thanks}</div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div
    class="v-row flex-shrink-0"
    style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
  >
    <button class="v-btn v-btn-primary" onclick={onClose}>{t("dialog.done")}</button>
  </div>
</Modal>
