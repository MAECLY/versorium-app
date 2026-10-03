<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type SecretsStatus } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { updates } from "$lib/update/state.svelte";
  import UpdatesSection from "$lib/settings/UpdatesSection.svelte";
  import { onboarding } from "$lib/onboarding/state.svelte";
  import SafetySectionCrash from "$lib/settings/SafetySectionCrash.svelte";

  // An optional credential, used for nothing but reading Versorium's own
  // releases. Checks run without it (spec §11, amended 2026-10-03); it matters
  // while the repository is private and when GitHub's anonymous rate limit
  // bites, which is why the field says so instead of asking anyone to "sign
  // in". It sits next to the panel that spends it, and that panel reloads
  // after a change because a token changes what the next check can see.
  //
  // The token is written and never read back: it lives in the OS credential
  // store and only Rust ever sees it again.
  let secrets = $state<SecretsStatus | null>(null);
  let token = $state("");
  let login = $state("");
  let notice = $state("");
  let busy = $state(false);

  onMount(() => {
    if (!isTauri()) return;
    void refresh();
  });

  async function refresh(): Promise<void> {
    try {
      secrets = await api.secretsStatus();
    } catch {
      secrets = null;
    }
  }

  async function connect(): Promise<void> {
    if (busy || !token.trim()) return;
    busy = true;
    notice = "";
    try {
      login = await api.secretsConnect("updates", token);
      token = "";
      await refresh();
      notice = t("git.connected") + ` @${login}`;
      await updates.load();
    } catch (e) {
      notice = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }

  async function forget(): Promise<void> {
    if (busy) return;
    busy = true;
    notice = "";
    try {
      await api.secretsForget("updates");
      login = "";
      await refresh();
      await updates.load();
    } catch (e) {
      notice = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }
</script>

<UpdatesSection />

<!-- The way back to the first-run guide. It used to sit permanently on the
     writing canvas as "Set up Versorium", which named it wrong and put a
     once-ever action where somebody works every day. This is where people look
     for it. -->
<section class="mb-6" aria-label={t("onboarding.title")}>
  <h3 class="v-section-title mb-1">{t("onboarding.title")}</h3>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("onboarding.replayHint")}</p>
  <button class="v-btn" onclick={() => void onboarding.start()}>{t("onboarding.replay")}</button>
</section>

<section class="mb-6" aria-label={t("git.updatesSlot")}>
  <h3 class="v-section-title mb-1">{t("git.updatesSlot")}</h3>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("git.updatesSlotHint")}</p>

  <div class="v-card p-3">
    {#if secrets && !secrets.store.usable}
      <p class="m-0" style="font-size: 12px; color: var(--warn);">{t("errors.keyring_unavailable")}</p>
    {:else if secrets?.updates}
      <div class="v-row" style="gap: 8px;">
        <span style="font-size: 12.5px; color: var(--ok);">{t("git.stored")}</span>
        <button class="v-btn" style="padding: 2px 10px; font-size: 12px;" disabled={busy} onclick={() => void forget()}>
          {t("git.forget")}
        </button>
      </div>
    {:else}
      <div class="v-row" style="gap: 8px;">
        <input
          type="password"
          placeholder={t("git.token")}
          value={token}
          oninput={(e) => (token = (e.currentTarget as HTMLInputElement).value)}
          style="flex: 1;"
          autocomplete="off"
        />
        <button class="v-btn" disabled={busy || !token.trim()} onclick={() => void connect()}>
          {t("git.connect")}
        </button>
      </div>
      <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("git.storedWhere")}</p>
    {/if}
    {#if notice}
      <p class="m-0 mt-2" style="font-size: 12px; color: var(--accent);" aria-live="polite">{notice}</p>
    {/if}
  </div>
</section>

<SafetySectionCrash />
