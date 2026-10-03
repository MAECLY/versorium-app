<script lang="ts">
  import { t, getLocale } from "$lib/i18n";
  import Modal from "$lib/components/Modal.svelte";
  import CoverPreview from "$lib/components/CoverPreview.svelte";
  import Checkbox from "$lib/components/forms/Checkbox.svelte";
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

  async function save(next: { cover?: boolean; colophon?: boolean }): Promise<void> {
    await store.setExportMatter(path, next.cover ?? cover, next.colophon ?? colophon);
  }

  let words = $derived(project?.chapters.reduce((total, c) => total + c.words, 0) ?? 0);
</script>

<Modal label={t("project.title")} {onClose}>
  <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("project.title")}</h2>
  <p class="v-muted m-0 mt-1" style="font-size: 12px; line-height: 1.6;">{t("project.intro")}</p>

  <!-- The preview is the point: a setting whose effect you can see is a setting
       you can decide about. -->
  <div class="v-row mt-4" style="gap: 20px; align-items: flex-start; flex-wrap: wrap;">
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
      <Checkbox
        label={t("project.coverLabel")}
        hint={t("project.coverHint")}
        checked={cover}
        onChange={(next) => void save({ cover: next })}
      />

      <div class="mt-3">
        <Checkbox
          label={t("project.colophonLabel")}
          hint={t("project.colophonHint")}
          checked={colophon}
          onChange={(next) => void save({ colophon: next })}
        />
      </div>

      {#if colophon}
        <!-- What the last page will actually say, from this novel's own data. -->
        <div class="v-card mt-3 p-3" style="font-size: 11.5px; line-height: 1.7;">
          <b>{t("project.colophonHeading")}</b>
          <div>{t("project.keys.title")}: {project?.meta.title}</div>
          {#if byline}<div>{t("project.keys.author")}: {byline}</div>{/if}
          <div>{t("project.keys.language")}: {project?.meta.language}</div>
          <div>{t("project.keys.chapters")}: {project?.chapters.length ?? 0}</div>
          <div>{t("project.keys.words")}: {words.toLocaleString(getLocale())}</div>
          <div class="v-muted mt-1">{t("project.colophonThanks")}</div>
        </div>
      {/if}
    </div>
  </div>

  <div
    class="v-row mt-4"
    style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);"
  >
    <button class="v-btn v-btn-primary" onclick={onClose}>{t("dialog.done")}</button>
  </div>
</Modal>
