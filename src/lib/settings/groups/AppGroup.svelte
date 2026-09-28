<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { updates } from "$lib/update/state.svelte";
  import UpdatesSection from "$lib/settings/UpdatesSection.svelte";
  import SafetySectionCrash from "$lib/settings/SafetySectionCrash.svelte";

  // This credential exists only so Versorium can read its own releases. It now
  // sits next to the panel that spends it, which is also why the panel notices
  // immediately instead of still reading "signed out".
  let token = $state("");
  let login = $state("");
  let notice = $state("");

  onMount(() => {
    if (!isTauri()) return;
    api
      .getSettings()
      .then((s) => (token = s.githubUpdatesToken ?? ""))
      .catch(() => {});
  });

  async function connect(): Promise<void> {
    const trimmed = token.trim();
    notice = "";
    if (!trimmed) return;
    try {
      login = await api.githubMe(trimmed);
      await api.setSettings({ githubUpdatesToken: trimmed });
      notice = t("git.connected") + ` @${login}`;
      await updates.load();
    } catch (e) {
      notice = store.codeMessagePublic(e);
    }
  }
</script>

<UpdatesSection />

<section class="mb-6" aria-label={t("git.updatesSlot")}>
  <h3 class="v-section-title mb-1">{t("git.updatesSlot")}</h3>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("git.updatesSlotHint")}</p>

  <div class="v-card p-3">
    <div class="v-row" style="justify-content: space-between;">
      <b style="font-size: 13px;">{t("git.updatesSlot")}</b>
      <span class="v-muted" style="font-size: 12px;">{login && `@${login}`}</span>
    </div>
    <div class="v-row mt-2" style="gap: 8px;">
      <input
        type="password"
        placeholder={t("git.token")}
        value={token}
        oninput={(e) => (token = (e.currentTarget as HTMLInputElement).value)}
        style="flex: 1;"
        autocomplete="off"
      />
      <button class="v-btn" onclick={() => void connect()}>{t("git.connect")}</button>
    </div>
    {#if notice}
      <p class="m-0 mt-2" style="font-size: 12px; color: var(--accent);">{notice}</p>
    {/if}
  </div>
</section>

<SafetySectionCrash />
