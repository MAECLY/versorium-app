<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLocale } from "$lib/i18n";
  import {
    api,
    isTauri,
    onBackupState,
    type BackupArchive,
    type BackupCoverage,
    type BackupDestination,
    type BackupOutcome,
    type BackupState,
    type SecretsStatus,
  } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { notices } from "$lib/notices/state.svelte";
  import { UNKNOWN_STATE, newerState } from "$lib/backup/state";
  import { humanSize } from "$lib/models/state.svelte";
  import NumberField from "$lib/components/forms/NumberField.svelte";

  /**
   * Three layers, named as layers, because they protect against different
   * things: the novel's own history survives a mistake, a synced folder
   * survives a lost laptop, GitHub survives both and costs an account. Showing
   * them as one list of options would let somebody turn on the cheapest and
   * believe they were covered.
   */
  const MAX_DESTINATIONS = 3;

  let destinations = $state<BackupDestination[]>([]);
  let chosen = $state<string[]>([]);
  let keep = $state(10);
  let archives = $state<[string, BackupArchive[]][]>([]);
  let results = $state<BackupOutcome[]>([]);
  let coverage = $state<BackupCoverage | null>(null);
  let checked = $state<Record<string, string>>({});
  let busy = $state(false);
  /** Whether a backup is running, as Rust reports it. Kept apart from `busy`,
      which this panel forgets whenever it is closed: leaving Settings in the
      middle of a backup and coming back used to offer Back up now again. */
  let backupState = $state<BackupState>(UNKNOWN_STATE);
  let running = $derived(backupState.running !== null);
  /** This panel's own press, from its save through to its results. */
  let pressing = $state(false);
  /** Why this panel's own press made no backup at all, said beside the button
      rather than at the foot of the section. */
  let pressError = $state("");
  /** A run this panel did not start is going: one pressed before Settings
      was last closed, or another novel's. It leaves no outcome to show. */
  let foreign = false;
  /** Such a run has ended, and the list below was read again. */
  let finished = $state(false);
  /** Where a restore put the copy. Kept here, not in a notice that goes by:
      it is the one place the folder's name is shown. */
  let restored = $state("");
  let error = $state("");

  let secrets = $state<SecretsStatus | null>(null);
  let token = $state("");
  let login = $state("");
  let showAdvanced = $state(false);

  let project = $derived(store.project);
  let full = $derived(chosen.length >= MAX_DESTINATIONS);

  onMount(() => {
    if (!isTauri()) return;
    void load();
    // Asked at once, so the button is right as soon as it can be, and again
    // once the listener is in place: a run that ends while the listener is
    // still being set up is otherwise never heard of. `newerState` keeps
    // whichever report is newest, however they arrive.
    let stop: (() => void) | undefined;
    let gone = false;
    const adopt = (next: BackupState) => {
      const was = backupState.running;
      backupState = newerState(backupState, next);
      if (backupState.running) {
        foreign ||= !pressing;
        finished = false;
      } else if (was && foreign) {
        // Nothing here knows how it went, so say that it ended, and read the
        // list again: it holds the archive that run made.
        foreign = false;
        finished = true;
        void refresh();
      }
    };
    const ask = () => void api.backupState().then(adopt).catch(() => undefined);
    ask();
    void onBackupState(adopt)
      .then((off) => {
        if (gone) return off();
        stop = off;
        ask();
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      stop?.();
    };
  });

  async function load(): Promise<void> {
    try {
      const [dests, status] = await Promise.all([api.backupDestinations(), api.secretsStatus()]);
      destinations = dests;
      secrets = status;
      const settings = await api.getSettings();
      chosen = settings.backupDirs ?? [];
      keep = settings.backupKeep ?? 10;
      await refresh();
    } catch (e) {
      error = store.codeMessagePublic(e);
    }
  }

  async function refresh(): Promise<void> {
    const path = project?.path;
    if (!path || chosen.length === 0) {
      archives = [];
      coverage = null;
      return;
    }
    try {
      [archives, coverage] = await Promise.all([api.backupList(path), api.backupCoverage(path)]);
    } catch {
      archives = [];
    }
  }

  /** Adding and removing are the same gesture: a destination is on or it is not. */
  async function toggle(path: string): Promise<void> {
    const next = chosen.includes(path) ? chosen.filter((p) => p !== path) : [...chosen, path];
    if (next.length > MAX_DESTINATIONS) {
      notices.inform(t("backup.full"));
      return;
    }
    // Named: in the corner stack, "here" would point at nothing.
    await save(next, chosen.includes(path) ? "" : t("backup.chosen", { name: name(path) }));
  }

  async function save(paths: string[], said: string): Promise<void> {
    await run(async () => {
      await api.backupConfigure(paths, keep);
      chosen = paths;
      results = [];
      checked = {};
      await refresh();
      const done = paths.length === 0 ? t("backup.turnedOff") : said;
      if (done) notices.inform(done, "backup.configure");
    });
  }

  /** Any folder, for Linux and for anyone whose client is not in the list. */
  async function pickFolder(): Promise<void> {
    const picked = await api.pickDirectory();
    if (typeof picked === "string" && !chosen.includes(picked)) await toggle(picked);
  }

  async function backupNow(): Promise<void> {
    const path = project?.path;
    if (!path) return;
    await run(async () => {
      pressing = true;
      pressError = "";
      finished = false;
      try {
        // What is on the page, not what the 800 ms save last wrote: the press
        // means "this". A save that fails stops here, and says that nothing
        // was backed up, rather than backing up the older text.
        try {
          await store.flushAll();
        } catch (e) {
          pressError = t("backup.notSavedFirst", { reason: store.codeMessagePublic(e) });
          return;
        }
        // Kept as a list. Two of three succeeding is a real outcome and saying
        // either "backed up" or "failed" would be a lie in one direction.
        results = await api.backupNow(path);
        await refresh();
      } catch (e) {
        pressError = store.codeMessagePublic(e);
      } finally {
        pressing = false;
      }
    });
  }

  async function verify(archive: BackupArchive): Promise<void> {
    await run(async () => {
      await api.backupVerify(archive.path);
      checked = { ...checked, [archive.path]: t("backup.verified") };
    });
  }

  async function restore(archive: BackupArchive): Promise<void> {
    const path = project?.path;
    if (!path) return;
    await run(async () => {
      // Extracted beside the original, never over it, so this cannot destroy
      // the work it exists to protect.
      const target = await api.backupRestore(archive.path, path, t("backup.restoredSuffix"));
      restored = t("backup.restored", { path: target });
    });
  }

  async function connect(): Promise<void> {
    await run(async () => {
      login = await api.secretsConnect("novel", token);
      token = "";
      secrets = await api.secretsStatus();
      notices.inform(t("git.novelConnected", { login }), "backup.github");
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
        notices.inform(t("git.pushed", { branch }), "backup.github");
      } else {
        const outcome = await api.gitPull(path);
        notices.inform(outcome.changed ? t("git.pulled") : t("git.alreadyCurrent"), "backup.github");
      }
    });
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    restored = "";
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

  /** A novel's title, from the binder's list, or else its folder's name. */
  function novelTitle(path: string): string {
    const known = store.projects.find((p) => p.path === path);
    return known?.meta.title ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  }

  /** The one live line beside Back up now. Another novel's run is named,
      because the button is off for it too: runs go one at a time. */
  let statusText = $derived.by(() => {
    const run = backupState.running;
    if (run && run.project !== project?.path) return t("backup.runningOther", { title: novelTitle(run.project) });
    if (run || pressing) return t("backup.running");
    return finished ? t("backup.finished") : "";
  });

  /**
   * The moment the backup was asked for, not the file's mtime.
   *
   * One press used to show 1:13:16 in one folder and 1:13:17 in another: those
   * were never two backups, they were two mtimes. Each destination writes at
   * its own speed, and a sync client rewrites the mtime when it re-downloads.
   */
  function archiveTime(archive: BackupArchive): number {
    return archive.stamped ?? archive.modified;
  }

  /** A destination's own name, for a message that has only its path. */
  function name(path: string): string {
    const known = destinations.find((d) => d.path === path);
    return known ? t(`backup.kinds.${known.kind}`) : path;
  }

  function outcomeText(outcome: BackupOutcome): string {
    const who = name(outcome.path);
    switch (outcome.state) {
      case "ok":
        return t("backup.resultOk", { name: who, size: humanSize(outcome.archive.bytes) });
      case "copy":
        return t("backup.resultCopy", { name: who, size: humanSize(outcome.archive.bytes) });
      case "unchanged":
        // Named with the time of the copy that is already there, because "since
        // when" is the question a writer has when told nothing was written.
        return t("backup.resultUnchanged", { name: who, when: when(archiveTime(outcome.archive)) });
      case "repaired":
        return t("backup.resultRepaired", { name: who, size: humanSize(outcome.archive.bytes) });
      case "unavailable":
        return t("backup.resultUnavailable", { name: who });
      case "busy":
        return t("backup.resultBusy", { name: who });
      default:
        return t("backup.resultFailed", { name: who, reason: store.codeMessagePublic(outcome.reason) });
    }
  }

  /** The deletion, when there was one. A press that removed nine files should
      not report only the one it kept. */
  function prunedText(outcome: BackupOutcome): string {
    const pruned = "pruned" in outcome ? outcome.pruned : 0;
    return pruned > 0 ? " " + t("backup.alsoPruned", { n: pruned }) : "";
  }

  /** Why nothing older was deleted, when that was held back. The archive was
      still written and read back; a clock somewhere is wrong, this one or
      that of another computer backing up into the same folder. */
  function heldText(outcome: BackupOutcome): string {
    const held = "held" in outcome ? outcome.held : undefined;
    return held ? " " + t("backup.last.held.clockBehind", { stamp: when(held.stamp) }) : "";
  }

  function outcomeColor(outcome: BackupOutcome): string {
    if ("held" in outcome && outcome.held) return "var(--warn)";
    switch (outcome.state) {
      case "ok":
      case "copy":
        return "var(--ok)";
      case "failed":
      case "repaired":
        return "var(--warn)";
      default:
        return "var(--text-mute)";
    }
  }
</script>

<section class="mb-6" aria-label={t("backup.title")}>
  <h3 class="v-h3 mb-1">{t("backup.title")}</h3>
  <p class="v-muted m-0 mb-3" style="font-size: 12px; line-height: 1.6;">{t("backup.intro")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("backup.none")}</p>
  {:else}
    <!-- Layer 1. Always on, nothing to configure: named so the other two read
         as additions to something that already exists. -->
    <div class="v-card mb-4 p-3">
      <b style="font-size: 13px;">{t("backup.layerHistory")}</b>
      <p class="v-muted m-0 mt-1" style="font-size: 12px; line-height: 1.6;">{t("backup.layerHistoryHint")}</p>
    </div>

    <h4 class="v-h4 mb-1">{t("backup.layerDestinations")}</h4>
    <p class="v-muted m-0 mb-1" style="font-size: 12px;">{t("backup.limit", { n: MAX_DESTINATIONS })}</p>
    <p class="v-muted m-0 mb-2" style="font-size: 12px; line-height: 1.6;">{t("backup.liveRepoHint")}</p>

    <ul class="m-0 mb-3 grid list-none gap-2 p-0" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));">
      {#each destinations as destination (destination.path)}
        {@const on = chosen.includes(destination.path)}
        <li class="v-card p-3" style={on ? "border-color: var(--accent);" : ""}>
          <div class="v-row" style="justify-content: space-between; gap: 8px;">
            <b style="font-size: 13px;">{t(`backup.kinds.${destination.kind}`)}</b>
            {#if !destination.available}
              <!-- Offered anyway: "not found" tells somebody their assumption
                   was wrong, while silence looks like a missing feature. -->
              <span class="v-muted" style="font-size: 11px;">{t("backup.notFound")}</span>
            {:else}
              <span class="v-muted" style="font-size: 11px;">
                {destination.offsite ? t("backup.offsite") : t("backup.onsite")}
              </span>
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
            aria-pressed={on}
            disabled={busy || !destination.available || (full && !on)}
            onclick={() => void toggle(destination.path)}
          >
            {on ? t("backup.chosenLabel") : t("backup.choose")}
          </button>
        </li>
      {/each}
    </ul>

    <div class="v-row mb-3" style="gap: 8px; flex-wrap: wrap;">
      <button class="v-btn" disabled={busy || full} onclick={() => void pickFolder()}>
        {t("backup.pickFolder")}
      </button>
      {#if chosen.length > 0}
        <button class="v-btn" disabled={busy} onclick={() => void save([], "")}>
          {t("backup.turnOff")}
        </button>
      {/if}
    </div>

    {#if coverage}
      <!-- Stated, not scored. "2 copies, 1 disk" is a sentence somebody can act
           on; a green tick next to a novel on one disk is not. -->
      <div class="v-card mb-3 p-3" aria-live="polite">
        <b style="font-size: 12.5px;">{t("backup.coverage")}</b>
        <p class="m-0 mt-1" style="font-size: 12.5px; line-height: 1.6;">
          {t("backup.copies", { n: coverage.copies })} ·
          {coverage.media === null ? t("backup.mediaUnknown") : t("backup.media", { n: coverage.media })} ·
          <span style={coverage.offsite ? "color: var(--ok);" : "color: var(--warn);"}>
            {coverage.offsite ? t("backup.hasOffsite") : t("backup.noOffsite")}
          </span>
        </p>
        {#each coverage.onTheNovelsDisk as path (path)}
          <p class="m-0 mt-1" style="font-size: 12px; color: var(--warn); line-height: 1.6;">
            {t("backup.sameDisk", { path: name(path) })}
          </p>
        {/each}
        {#if coverage.copies >= 3 && coverage.offsite && coverage.onTheNovelsDisk.length === 0}
          <p class="m-0 mt-1" style="font-size: 12px; color: var(--ok);">{t("backup.allSet")}</p>
        {/if}
      </div>
    {/if}

    {#if chosen.length > 0}
      <div class="mb-3">
        <NumberField
          label={t("backup.keep")}
          hint={t("backup.keepHint")}
          value={keep}
          min={1}
          max={200}
          inline
          onCommit={(next) => {
            keep = next;
            void save(chosen, "");
          }}
        />
      </div>

      <p class="v-muted m-0 mb-2" style="font-size: 11.5px; line-height: 1.6;">
        {t("backup.onlyWhenChanged")}
      </p>

      <div class="v-row mb-2" style="gap: 10px;">
        <!-- Disabled for any backup Rust reports, including one this panel
             did not start or started before it was last closed. The state is
             said beside the button rather than on it: a disabled button's
             text is faded below a readable contrast, and a run can last. -->
        <button class="v-btn v-btn-primary" disabled={busy || running || !project} onclick={() => void backupNow()}>
          {busy && !(running || pressing) ? t("backup.working") : t("backup.now")}
        </button>
        <!-- Always in the page, so its first words are announced. -->
        <span role="status" class="v-muted" style="font-size: 12.5px;">{statusText}</span>
      </div>

      {#if pressError}
        <p role="alert" class="m-0 mb-2" style="font-size: 12px; color: var(--warn); line-height: 1.6;">
          {pressError}
        </p>
      {/if}

      {#if results.length > 0}
        <ul class="m-0 mb-2 flex list-none flex-col gap-1 p-0" aria-live="polite">
          {#each results as outcome (outcome.path)}
            <li style={`font-size: 12px; color: ${outcomeColor(outcome)};`}>
              {outcomeText(outcome)}{prunedText(outcome)}{heldText(outcome)}
            </li>
          {/each}
        </ul>
      {/if}

      {#each archives as [dir, stored] (dir)}
        {#if stored.length > 0}
          <h4 class="v-h4 mb-1 mt-3">{name(dir)}</h4>
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            {#each stored as archive (archive.path)}
              <li class="v-row" style="gap: 10px; font-size: 12px; padding: 2px 0;">
                <span class="v-muted" style="font-variant-numeric: tabular-nums;">
                {when(archiveTime(archive))}
              </span>
                <span class="v-muted">{humanSize(archive.bytes)}</span>
                {#if checked[archive.path]}
                  <span style="color: var(--ok); font-size: 11.5px;">{checked[archive.path]}</span>
                {/if}
                <button
                  class="v-btn"
                  style="padding: 0 8px; font-size: 11.5px; margin-left: auto;"
                  disabled={busy}
                  onclick={() => void verify(archive)}
                >
                  {t("backup.verify")}
                </button>
                <button
                  class="v-btn"
                  style="padding: 0 8px; font-size: 11.5px;"
                  disabled={busy || !project}
                  onclick={() => void restore(archive)}
                >
                  {t("backup.restore")}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/each}

      {#if archives.some(([, stored]) => stored.length > 0)}
        <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("backup.restoreHint")}</p>
        <p class="v-muted m-0 mt-1" style="font-size: 11px;">{t("backup.verifyHint")}</p>
      {/if}
    {/if}

    <!-- Layer 3. It needs an account and a token, which a synced folder does
         not. Collapsed so the simple path is the visible one. -->
    <h4 class="v-h4 mb-1 mt-4">{t("backup.layerGithub")}</h4>
    <button
      class="v-btn"
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

    {#if restored}
      <p class="m-0 mt-3" style="font-size: 12px; color: var(--accent);" aria-live="polite">{restored}</p>
    {/if}
    {#if error}
      <p role="alert" class="m-0 mt-2" style="font-size: 12px; color: var(--warn);">{error}</p>
    {/if}
  {/if}
</section>
