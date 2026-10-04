<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { isTauri } from "$lib/tauri";
  import { updates } from "$lib/update/state.svelte";
  import { statusLine } from "$lib/update/status";

  const CHANNELS = ["stable", "beta"] as const;

  let status = $derived(updates.status);
  // Recomputed when the language changes too: `t()` reads the locale.
  let line = $derived(statusLine(status));

  onMount(() => {
    // Reading the stored state costs nothing; checking the network does not
    // happen here, only behind the button or the startup rule (spec §11).
    if (isTauri()) void updates.load();
  });
</script>

<section class="mb-6" aria-label={t("updates.title")}>
  <h3 class="v-h3 mb-2">{t("updates.title")}</h3>
  <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t("updates.intro")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("updates.none")}</p>
  {:else}
    <div class="v-card p-3">
      <div class="v-row" style="justify-content: space-between; gap: 8px;">
        <span style="font-size: 13px;">
          {t("updates.currentVersion")}:
          <b style="font-family: var(--font-mono, ui-monospace, monospace);">
            {status?.currentVersion ?? "—"}
          </b>
        </span>
        <!-- Not gated on a token (spec §11, amended 2026-10-03): without one
             the check is anonymous, which is enough for a public repository.
             About's "Check for updates in Application ›" lands here. -->
        <button
          class="v-btn"
          style="padding: 2px 10px; font-size: 12px;"
          disabled={updates.busy}
          data-settings-focus="app:updates"
          onclick={() => void updates.check()}
        >
          {updates.busy ? t("updates.checking") : t("updates.checkNow")}
        </button>
      </div>

      <!-- Every outcome of a check is a line here, never an alert: nothing
           published, a rate limit and offline included (§11.7). -->
      <p class="m-0 mt-2" style="font-size: 12.5px;" aria-live="polite">
        <span
          class:v-muted={line.tone === "quiet"}
          style:color={line.tone === "accent" ? "var(--accent)" : line.tone === "warn" ? "var(--warn)" : null}
        >
          {line.text}
        </span>
      </p>
      {#if line.hint}
        <p class="v-muted m-0 mt-1" style="font-size: 11px;">{line.hint}</p>
      {/if}

      <!-- The command itself failing, which no check outcome above covers. -->
      {#if updates.error}
        <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">
          {updates.error}
        </p>
      {/if}
    </div>

    <label class="v-row mt-3" style="gap: 8px; font-size: 13px;">
      <input
        type="checkbox"
        checked={status?.automatic ?? true}
        disabled={updates.busy}
        onchange={(e) => void updates.setAutomatic(e.currentTarget.checked)}
      />
      {t("updates.automatic")}
    </label>
    <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("updates.automaticHint")}</p>

    <label class="v-row mt-3" style="gap: 8px; font-size: 13px;">
      {t("updates.channel")}
      <span class="v-select">
      <select
        value={status?.channel ?? "stable"}
        disabled={updates.busy}
        onchange={(e) => void updates.setChannel(e.currentTarget.value as "stable" | "beta")}
      >
        {#each CHANNELS as channel (channel)}
          <option value={channel}>{t(`updates.channels.${channel}`)}</option>
        {/each}
      </select>
      </span>
    </label>
    <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("updates.channelHint")}</p>

    <p class="v-muted m-0 mt-3" style="font-size: 11px;">{t("updates.gatekeeper")}</p>
  {/if}
</section>
