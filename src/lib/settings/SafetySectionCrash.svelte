<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type CrashEntry } from "$lib/tauri";
  import { errorMessage } from "$lib/i18n/errors";

  let crashes = $state<CrashEntry[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** The report URL, fetched only when someone asks for it (spec §12: opt-in). */
  let reportUrl = $state<Record<string, string>>({});
  let copied = $state<string | null>(null);

  onMount(() => {
    if (isTauri()) void load();
  });

  async function load(): Promise<void> {
    busy = true;
    error = null;
    try {
      crashes = await api.crashList(20);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function prepare(id: string): Promise<void> {
    if (reportUrl[id]) return;
    try {
      reportUrl = { ...reportUrl, [id]: await api.crashReportUrl(id) };
    } catch (e) {
      error = errorMessage(e);
    }
  }

  /// Spec §12: Report opens the browser. Nothing is sent until they do.
  async function openIssue(id: string): Promise<void> {
    const url = reportUrl[id];
    if (!url) return;
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function copy(id: string): Promise<void> {
    const url = reportUrl[id];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      copied = id;
    } catch {
      // Clipboard permission is not worth an error; the link is on screen.
      copied = null;
    }
  }

  async function clear(): Promise<void> {
    busy = true;
    try {
      await api.crashClear();
      crashes = [];
      reportUrl = {};
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  function when(ts: number): string {
    return new Date(ts).toLocaleString();
  }
</script>

<section class="mb-6" aria-label={t("crash.title")}>
  <div class="v-row mb-2" style="justify-content: space-between;">
    <h3 class="v-section-title m-0">{t("crash.title")}</h3>
    {#if isTauri() && crashes.length > 0}
      <button
        class="v-btn"
        style="padding: 2px 10px; font-size: 12px;"
        disabled={busy}
        onclick={() => void clear()}
      >
        {t("crash.clear")}
      </button>
    {/if}
  </div>

  <!-- Spec §12: local only, no prose, and nothing leaves without a deliberate act. -->
  <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("crash.privacy")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("crash.none")}</p>
  {:else if crashes.length === 0}
    <p class="v-muted m-0" style="font-size: 13px;">{t("crash.empty")}</p>
  {:else}
    <ul class="m-0 flex list-none flex-col gap-2 p-0" aria-busy={busy}>
      {#each crashes as crash (crash.id)}
        <li class="v-card p-3">
          <div class="v-row" style="justify-content: space-between; gap: 8px;">
            <b style="font-size: 13px;">{crash.kind}</b>
            <span class="v-muted" style="font-size: 11px;">{when(crash.ts)}</span>
          </div>
          <p class="v-muted m-0 mt-1" style="font-size: 12px;">
            {t("crash.build", { version: crash.version, os: crash.os, arch: crash.arch })}
          </p>
          <p
            class="m-0 mt-1"
            style="font-size: 12px; font-family: var(--font-mono, ui-monospace, monospace); overflow-wrap: anywhere;"
          >
            {crash.message}
          </p>

          {#if reportUrl[crash.id]}
            <div class="v-row mt-2" style="gap: 8px; flex-wrap: wrap;">
              <button
                class="v-btn"
                style="padding: 2px 10px; font-size: 12px;"
                onclick={() => void openIssue(crash.id)}
              >
                {t("crash.openIssue")}
              </button>
              <button
                class="v-btn"
                style="padding: 2px 10px; font-size: 12px;"
                onclick={() => void copy(crash.id)}
              >
                {copied === crash.id ? t("crash.copied") : t("crash.copyLink")}
              </button>
            </div>
            <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("crash.reviewHint")}</p>
          {:else}
            <button
              class="v-btn mt-2"
              style="padding: 2px 10px; font-size: 12px;"
              onclick={() => void prepare(crash.id)}
            >
              {t("crash.report")}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{error}</p>
  {/if}
</section>
