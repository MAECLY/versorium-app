<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import {
    api,
    isTauri,
    type BackupArchive,
    type BackupDestination,
    type SecretsStatus,
  } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { humanSize } from "$lib/models/state.svelte";

  // Two ways to keep a copy, and they are not equivalent. A synced folder needs
  // no account and works offline; GitHub needs a token and is therefore the
  // advanced one, not the default.
  let destinations = $state<BackupDestination[]>([]);
  let chosen = $state("");
  let keep = $state(10);
  let archives = $state<BackupArchive[]>([]);
  let busy = $state(false);
  let notice = $state("");
  let error = $state("");

  let secrets = $state<SecretsStatus | null>(null);
  let token = $state("");
  let login = $state("");
  let showAdvanced = $state(false);

  let project = $derived(store.project);

  onMount(() => {
    if (!isTauri()) return;
    void load();
  });

  async function load(): Promise<void> {
    try {
      const [dests, status] = await Promise.all([api.backupDestinations(), api.secretsStatus()]);
      destinations = dests;
      secrets = status;
      const settings = await api.getSettings();
      chosen = settings.backupDir ?? "";
      keep = settings.backupKeep ?? 10;
      if (chosen) await refreshArchives();
    } catch (e) {
      error = store.codeMessagePublic(e);
    }
  }

  async function refreshArchives(): Promise<void> {
    const path = project?.path;
    if (!path || !chosen) {
      archives = [];
      return;
    }
    try {
      archives = await api.backupList(path);
    } catch {
      archives = [];
    }
  }

  async function choose(path: string): Promise<void> {
    await run(async () => {
      await api.backupConfigure(path, keep);
      chosen = path;
      await refreshArchives();
      notice = path ? t("backup.chosen") : t("backup.turnedOff");
    });
  }

  /** Any folder, for Linux and for anyone whose client is not in the list. */
  async function pickFolder(): Promise<void> {
    const picked = await api.pickDirectory();
    if (typeof picked === "string") await choose(picked);
  }

  async function backupNow(): Promise<void> {
    const path = project?.path;
    if (!path) return;
    await run(async () => {
      const archive = await api.backupNow(path);
      notice = t("backup.written", { size: humanSize(archive.bytes) });
      await refreshArchives();
    });
  }

  async function restore(archive: BackupArchive): Promise<void> {
    const path = project?.path;
    if (!path) return;
    await run(async () => {
      // Extracted beside the original, never over it, so this cannot destroy
      // the work it exists to protect.
      const target = await api.backupRestore(archive.path, path, t("backup.restoredSuffix"));
      notice = t("backup.restored", { path: target });
    });
  }

  async function connect(): Promise<void> {
    await run(async () => {
      login = await api.secretsConnect("novel", token);
      token = "";
      secrets = await api.secretsStatus();
      notice = t("git.connected") + ` @${login}`;
    });
  }

  async function forget(): Promise<void> {
    await run(async () => {
      await api.secretsForget("novel");
      login = "";
      secrets = await api.secretsStatus();
    });
  }

  async function sync(direction: "push" | "pull"): Promise<void> {
    const path = project?.path;
    if (!path) return;
    await run(async () => {
      if (direction === "push") {
        const branch = await api.gitPush(path);
        notice = t("git.pushed", { branch });
      } else {
        const outcome = await api.gitPull(path);
        notice = outcome.changed ? t("git.pulled") : t("git.alreadyCurrent");
      }
    });
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    notice = "";
    try {
      await action();
    } catch (e) {
      error = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }

  function when(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString(getLocale());
  }
</script>

<section class="mb-6" aria-label={t("backup.title")}>
  <h3 class="v-section-title mb-1">{t("backup.title")}</h3>
  <p class="v-muted m-0 mb-3" style="font-size: 12px; line-height: 1.6;">{t("backup.intro")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("backup.none")}</p>
  {:else}
    <ul class="m-0 mb-3 flex list-none flex-col gap-2 p-0">
      {#each destinations as destination (destination.path)}
        <li class="v-card p-3" style={chosen === destination.path ? "border-color: var(--accent);" : ""}>
          <div class="v-row" style="justify-content: space-between; gap: 8px;">
            <b style="font-size: 13px;">{t(`backup.kinds.${destination.kind}`)}</b>
            {#if !destination.available}
              <!-- Offered anyway: "not found" tells somebody their assumption
                   was wrong, while silence looks like a missing feature. -->
              <span class="v-muted" style="font-size: 11px;">{t("backup.notFound")}</span>
            {/if}
          </div>
          <p
            class="v-muted m-0 mt-1"
            style="font-size: 11px; font-family: var(--font-mono, ui-monospace, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
            title={destination.path}
          >
            {destination.path}
          </p>
          <button
            class="v-btn mt-2"
            style="padding: 2px 10px; font-size: 12px;"
            disabled={busy || !destination.available}
            onclick={() => void choose(destination.path)}
          >
            {chosen === destination.path ? t("backup.chosenLabel") : t("backup.choose")}
          </button>
        </li>
      {/each}
    </ul>

    <div class="v-row mb-3" style="gap: 8px; flex-wrap: wrap;">
      <button class="v-btn" disabled={busy} onclick={() => void pickFolder()}>
        {t("backup.pickFolder")}
      </button>
      {#if chosen}
        <button class="v-btn" disabled={busy} onclick={() => void choose("")}>
          {t("backup.turnOff")}
        </button>
      {/if}
    </div>

    {#if chosen}
      <label class="v-row mb-3" style="gap: 8px; font-size: 13px;">
        {t("backup.keep")}
        <input
          type="number"
          min="1"
          max="200"
          value={keep}
          style="width: 80px;"
          onchange={(e) => {
            keep = Number((e.currentTarget as HTMLInputElement).value);
            void choose(chosen);
          }}
        />
      </label>

      <div class="v-row mb-2" style="gap: 8px;">
        <button class="v-btn v-btn-primary" disabled={busy || !project} onclick={() => void backupNow()}>
          {busy ? t("backup.working") : t("backup.now")}
        </button>
      </div>

      {#if archives.length > 0}
        <h4 class="v-section-title mb-1 mt-3">{t("backup.stored")}</h4>
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          {#each archives as archive (archive.path)}
            <li class="v-row" style="gap: 10px; font-size: 12px; padding: 2px 0;">
              <span class="v-muted" style="font-variant-numeric: tabular-nums;">{when(archive.modified)}</span>
              <span class="v-muted">{humanSize(archive.bytes)}</span>
              <button
                class="v-btn"
                style="padding: 0 8px; font-size: 11.5px; margin-left: auto;"
                disabled={busy || !project}
                onclick={() => void restore(archive)}
              >
                {t("backup.restore")}
              </button>
            </li>
          {/each}
        </ul>
        <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("backup.restoreHint")}</p>
      {/if}
    {/if}

    <!-- GitHub, demoted: it needs an account and a token, which a synced folder
         does not. Collapsed so the simple path is the visible one. -->
    <button
      class="v-btn mt-4"
      style="padding: 2px 10px; font-size: 12px;"
      aria-expanded={showAdvanced}
      onclick={() => (showAdvanced = !showAdvanced)}
    >
      {t("backup.advanced")}
    </button>

    {#if showAdvanced}
      <div class="v-card mt-2 p-3">
        <b style="font-size: 13px;">{t("git.novelSlot")}</b>
        <p class="v-muted m-0 mt-1" style="font-size: 12px;">{t("git.novelSlotHint")}</p>

        {#if secrets && !secrets.store.usable}
          <p class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">
            {t("errors.keyring_unavailable")}
          </p>
        {:else if secrets?.novel}
          <div class="v-row mt-2" style="gap: 8px;">
            <span style="font-size: 12.5px; color: var(--ok);">{t("git.stored")}</span>
            <button class="v-btn" style="padding: 2px 10px; font-size: 12px;" disabled={busy} onclick={() => void forget()}>
              {t("git.forget")}
            </button>
          </div>
          <div class="v-row mt-2" style="gap: 8px; flex-wrap: wrap;">
            <button class="v-btn" disabled={busy || !project} onclick={() => void sync("push")}>
              {t("git.push")}
            </button>
            <button class="v-btn" disabled={busy || !project} onclick={() => void sync("pull")}>
              {t("git.pull")}
            </button>
          </div>
        {:else}
          <div class="v-row mt-2" style="gap: 8px;">
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
      </div>
    {/if}

    {#if notice}
      <p class="m-0 mt-3" style="font-size: 12px; color: var(--accent);" aria-live="polite">{notice}</p>
    {/if}
    {#if error}
      <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{error}</p>
    {/if}
  {/if}
</section>
