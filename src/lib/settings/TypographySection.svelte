<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type FontEntry } from "$lib/tauri";
  import { errorMessage } from "$lib/i18n/errors";
  import { editorPreferences } from "$lib/editor/state.svelte";
  import { fontFamilyValue, markedFont } from "$lib/editor/preferences";

  let fonts = $state<FontEntry[]>([]);
  let defaultBody = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  /** The editor renders prose, so only body faces are offered here. */
  let body = $derived(fonts.filter((f) => f.role === "body"));
  // The face the page is in, as Rust answered it: the same value the editor
  // applies, so the mark cannot point at one face while the page shows another.
  let marked = $derived(markedFont(body, editorPreferences.font));
  // The sample is set in that face too, marked or not: settings naming a face
  // the panel does not offer (the catalogue's mono face, by a hand edit) mark
  // no row, and the page is in that face all the same. Before any answer, the
  // page is in the stylesheet's face, the catalogue's default
  // (tests/unit/editor-font.test.ts keeps the two equal).
  let sample = $derived(
    fontFamilyValue(editorPreferences.font?.stack) ?? fonts.find((f) => f.id === defaultBody)?.stack,
  );
  let shownError = $derived(error ?? editorPreferences.fontError);

  onMount(() => {
    if (isTauri()) void load();
  });

  // The face is read again on every visit, as EditorGroup reads the rest of
  // the group: App reads it at launch, and a launch read that failed would
  // otherwise leave the page in the stylesheet's face and no row marked
  // until a face was chosen.
  async function load(): Promise<void> {
    busy = true;
    error = null;
    try {
      const [catalog] = await Promise.all([api.fontsCatalog(), editorPreferences.loadFont()]);
      fonts = catalog.fonts;
      defaultBody = catalog.defaultBody;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function choose(id: string): Promise<void> {
    if (busy || id === marked) return;
    busy = true;
    error = null;
    await editorPreferences.chooseFont(id);
    busy = false;
  }
</script>

<section class="mb-6" aria-label={t("settings.sections.typography")}>
  <h3 class="v-h3 mb-2">{t("settings.sections.typography")}</h3>
  <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("typography.intro")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("typography.none")}</p>
  {:else}
    <ul class="m-0 flex list-none flex-col gap-2 p-0" aria-busy={busy}>
      {#each body as font (font.id)}
        {@const chosen = font.id === marked}
        <li>
          <button
            class="v-list-item {chosen ? 'v-list-item-active' : ''}"
            aria-current={chosen ? "true" : undefined}
            disabled={busy}
            style="width: 100%; text-align: left;"
            onclick={() => void choose(font.id)}
          >
            <span style="font-size: 13px;">{font.family}</span>
            <span class="v-muted" style="font-size: 11px;">{font.license}</span>
            <!-- Not bundled, a face renders only if the machine has it. The
                 catalogue knows which are sure to be there (`available`); a
                 face that may not be, chosen, can leave the page looking as
                 it did, and the row says so before it is chosen. -->
            {#if !font.bundled}
              <span class="v-muted" style="font-size: 11px; margin-left: auto;">
                {font.available ? t("typography.systemFace") : t("typography.ifInstalled")}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>

    {#if sample}
      <p
        class="m-0 mt-3"
        style="font-family: {sample}; font-size: 17px; line-height: 1.7;"
      >
        {t("typography.sample")}
      </p>
    {/if}

    <!-- No Download button: nothing in this catalogue can be fetched yet, and a
         control that cannot work is worse than an honest absence. -->
    <p class="v-muted m-0 mt-3" style="font-size: 11px;">{t("typography.downloadLater")}</p>

    {#if shownError}
      <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{shownError}</p>
    {/if}
  {/if}
</section>
