<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type FontEntry } from "$lib/tauri";
  import { errorMessage } from "$lib/i18n/errors";

  let fonts = $state<FontEntry[]>([]);
  let selected = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  /** The editor renders prose, so only body faces are offered here. */
  let body = $derived(fonts.filter((f) => f.role === "body"));
  let current = $derived(body.find((f) => f.id === selected) ?? body[0]);

  onMount(() => {
    if (isTauri()) void load();
  });

  async function load(): Promise<void> {
    busy = true;
    error = null;
    try {
      const [catalog, chosen] = await Promise.all([api.fontsCatalog(), api.editorFont()]);
      fonts = catalog.fonts;
      selected = chosen;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function choose(id: string): Promise<void> {
    if (busy || id === selected) return;
    busy = true;
    error = null;
    try {
      selected = await api.setEditorFont(id);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="mb-6" aria-label={t("settings.sections.typography")}>
  <h3 class="v-section-title mb-2">{t("settings.sections.typography")}</h3>
  <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("typography.intro")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("typography.none")}</p>
  {:else}
    <ul class="m-0 flex list-none flex-col gap-2 p-0" aria-busy={busy}>
      {#each body as font (font.id)}
        {@const chosen = font.id === selected}
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
            {#if !font.bundled}
              <span class="v-muted" style="font-size: 11px; margin-left: auto;">
                {t("typography.systemFace")}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>

    {#if current}
      <p
        class="m-0 mt-3"
        style="font-family: {current.stack}; font-size: 17px; line-height: 1.7;"
      >
        {t("typography.sample")}
      </p>
    {/if}

    <!-- No Download button: nothing in this catalogue can be fetched yet, and a
         control that cannot work is worse than an honest absence. -->
    <p class="v-muted m-0 mt-3" style="font-size: 11px;">{t("typography.downloadLater")}</p>

    {#if error}
      <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{error}</p>
    {/if}
  {/if}
</section>
