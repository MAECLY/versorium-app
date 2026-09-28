<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";

  // Only the novel's own access lives here. The token that authorizes update
  // downloads is a different credential for a different purpose and sits under
  // Application — keeping them apart is what stops them being confused.
  let token = $state("");
  let login = $state("");
  let repoName = $state("");
  let busy = $state(false);
  let notice = $state("");

  onMount(() => {
    if (isTauri()) {
      api
        .getSettings()
        .then((s) => (token = s.githubNovelToken ?? ""))
        .catch(() => {});
    }
    if (store.project) repoName = store.project.path.split("/").pop() ?? "";
  });

  async function connect(): Promise<void> {
    const trimmed = token.trim();
    notice = "";
    if (!trimmed) return;
    try {
      login = await api.githubMe(trimmed);
      await api.setSettings({ githubNovelToken: trimmed });
      notice = t("git.connected") + ` @${login}`;
    } catch (e) {
      notice = store.codeMessagePublic(e);
    }
  }

  async function createRepo(): Promise<void> {
    const trimmed = token.trim();
    const name = repoName.trim();
    if (!trimmed || !name || busy) return;
    busy = true;
    notice = "";
    try {
      const url = await api.githubCreateRepo(trimmed, name);
      if (store.project) await api.gitRemoteAdd(store.project.path, "origin", url);
      notice = url;
    } catch (e) {
      notice = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="mb-6" aria-label={t("git.title")}>
  <h3 class="v-section-title mb-1">{t("git.novelSlot")}</h3>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("git.novelSlotHint")}</p>

  <div class="v-card mb-3 p-3">
    <div class="v-row" style="justify-content: space-between;">
      <b style="font-size: 13px;">{t("git.novelSlot")}</b>
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

    {#if token.trim()}
      <div class="v-row mt-2" style="gap: 8px;">
        <input
          type="text"
          placeholder={t("git.repoName")}
          value={repoName}
          oninput={(e) => (repoName = (e.currentTarget as HTMLInputElement).value)}
          style="flex: 1;"
        />
        <button class="v-btn" disabled={busy || !repoName.trim()} onclick={() => void createRepo()}>
          {t("git.createRepo")}
        </button>
      </div>
      <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("git.privateDefault")}</p>
    {:else}
      <p class="v-muted m-0 mt-2" style="font-size: 12px;">{t("git.noToken")}</p>
    {/if}
  </div>

  {#if notice}
    <p class="m-0" style="font-size: 12px; color: var(--accent);">{notice}</p>
  {/if}
</section>
