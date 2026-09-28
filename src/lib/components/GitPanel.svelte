<script lang="ts">
  import { t } from "$lib/i18n";
  import { api, isTauri } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import type { GitStatus, GitCommit, GitBranches, GitRemote } from "$lib/tauri";

  let { open, onClose }: { open: boolean; onClose: () => void } = $props();

  type Tab = "status" | "log" | "diff" | "advanced";
  let tab = $state<Tab>("status");
  let status = $state<GitStatus | null>(null);
  let log = $state<GitCommit[]>([]);
  let diffText = $state("");
  let branches = $state<GitBranches | null>(null);
  let remotes = $state<GitRemote[]>([]);
  let commitMsg = $state("");
  let newBranch = $state("");
  let busy = $state(false);
  let notice = $state("");

  /**
   * Every file that differs from the last snapshot, in one list. Git's modified
   * / staged / untracked split is collapsed because Versorium commits the whole
   * project at once: the distinction never changes what the writer can do.
   */
  let changed = $derived.by(() => {
    const seen = new Set<string>();
    const out: { path: string; isNew: boolean }[] = [];
    const add = (path: string, isNew: boolean) => {
      if (seen.has(path)) return;
      seen.add(path);
      out.push({ path, isNew });
    };
    for (const f of status?.untracked ?? []) add(f, true);
    for (const f of status?.modified ?? []) add(f, false);
    for (const f of status?.staged ?? []) add(f, false);
    return out;
  });

  function projectPath(): string | null {
    return store.project?.path ?? null;
  }

  async function refresh(): Promise<void> {
    const path = projectPath();
    if (!path || !isTauri()) return;
    const [st, lg, df, br, rm] = await Promise.allSettled([
      api.gitStatus(path),
      api.gitLog(path, 50),
      api.gitDiff(path),
      api.gitBranches(path),
      api.gitRemotes(path),
    ]);
    if (st.status === "fulfilled") status = st.value;
    if (lg.status === "fulfilled") log = lg.value;
    if (df.status === "fulfilled") diffText = df.value;
    if (br.status === "fulfilled") branches = br.value;
    if (rm.status === "fulfilled") remotes = rm.value;
  }

  $effect(() => {
    if (open) void refresh();
  });

  function fmtTime(ts: number): string {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function doCommit(): Promise<void> {
    const path = projectPath();
    if (!path || busy) return;
    busy = true;
    notice = "";
    try {
      await store.flushAll();
      const described = commitMsg.trim();
      await api.gitCommit(
        path,
        described || t("git.snapshotOf", { when: fmtTime(Date.now() / 1000) }),
      );
      commitMsg = "";
      await refresh();
    } catch (e) {
      notice = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }

  async function createBranch(): Promise<void> {
    const path = projectPath();
    const name = newBranch.trim();
    if (!path || !name || busy) return;
    busy = true;
    notice = "";
    try {
      await api.gitBranchCreate(path, name);
      newBranch = "";
      await refresh();
    } catch (e) {
      notice = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }

  async function removeRemote(name: string): Promise<void> {
    const path = projectPath();
    if (!path || busy) return;
    busy = true;
    try {
      await api.gitRemoteRemove(path, name);
      await refresh();
    } catch (e) {
      notice = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if open}
  <div
    class="v-row flex-shrink-0 border-t"
    style="border-color: var(--border); background: var(--bg-panel); height: 220px; flex-direction: column;"
    role="region"
    aria-label={t("git.title")}
  >
    <div class="v-row flex-shrink-0" style="gap: 4px; padding: 6px 12px 0;">
      {#each (["status", "log", "diff", "advanced"] as Tab[]) as tb (tb)}
        <button
          class="v-btn"
          style="padding: 2px 10px; opacity: {tab === tb ? 1 : 0.55};"
          onclick={() => {
            tab = tb;
            void refresh();
          }}
        >
          {t(`git.tab_${tb}`)}
        </button>
      {/each}
      <button class="v-btn" style="margin-left: auto; padding: 2px 10px;" onclick={onClose}>✕</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-2" style="font-size: 13px;">
      {#if notice}
        <p class="m-0 mb-2" style="color: var(--warn);">{notice}</p>
      {/if}

      {#if tab === "status"}
        {#if changed.length === 0}
          <p class="v-muted m-0">{t("git.clean")}</p>
        {:else}
          <p class="m-0 mb-1"><b>{t("git.changedCount", { count: changed.length })}</b></p>
          <ul class="m-0" style="padding-left: 0; list-style: none;">
            {#each changed as file (file.path)}
              <li class="v-row" style="gap: 8px; padding: 1px 0;">
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {file.path}
                </span>
                <span class="v-muted" style="font-size: 11px;">
                  {file.isNew ? t("git.fileNew") : t("git.fileEdited")}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="v-row mt-3" style="gap: 8px;">
          <input
            class="v-input"
            type="text"
            placeholder={t("git.message")}
            value={commitMsg}
            oninput={(e) => (commitMsg = (e.currentTarget as HTMLInputElement).value)}
            style="flex: 1;"
          />
          <button class="v-btn" disabled={busy} onclick={() => void doCommit()}>
            {t("git.commit")}
          </button>
        </div>
      {:else if tab === "log"}
        <ul class="m-0" style="padding-left: 0; list-style: none;">
          {#each log as c (c.sha)}
            <li class="v-row" style="gap: 10px; padding: 3px 0; border-bottom: 1px solid var(--border);" title={c.short}>
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {c.message}
              </span>
              <span class="v-muted" style="font-size: 11px;">{c.author}</span>
              <span class="v-muted" style="font-size: 11px;">{fmtTime(c.time)}</span>
            </li>
          {:else}
            <li class="v-muted">{t("errors.no_commits")}</li>
          {/each}
        </ul>
      {:else if tab === "diff"}
        {#if diffText}
          <pre class="m-0" style="font-size: 12px; white-space: pre-wrap;">{diffText}</pre>
        {:else}
          <p class="v-muted m-0">{t("git.clean")}</p>
        {/if}
      {:else}
        <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("git.advancedNote")}</p>
        <p class="v-muted m-0 mb-2" style="font-size: 12px;">
          {status?.branch ?? "—"}
          {#if status && status.ahead > 0} · {status.ahead} {t("git.ahead")}{/if}
          {#if status && status.behind > 0} · {status.behind} {t("git.behind")}{/if}
        </p>
        <div class="v-row" style="gap: 8px;">
          <input
            class="v-input"
            type="text"
            placeholder={t("git.newBranch")}
            value={newBranch}
            oninput={(e) => (newBranch = (e.currentTarget as HTMLInputElement).value)}
            style="flex: 1; max-width: 240px;"
          />
          <button class="v-btn" disabled={busy || !newBranch.trim()} onclick={() => void createBranch()}>
            {t("git.create")}
          </button>
        </div>
        <ul class="m-0 mt-2" style="padding-left: 0; list-style: none;">
          {#each branches?.branches ?? [] as b (b)}
            <li style="padding: 2px 0;">
              {#if b === branches?.current}<span style="color: var(--accent);" aria-hidden="true">→ </span>{/if}
              {b}
            </li>
          {/each}
        </ul>
        <h4 class="v-section-title mt-3 mb-1">{t("git.remotes")}</h4>
        {#if remotes.length === 0}
          <p class="v-muted m-0" style="font-size: 12px;">{t("git.noRemotes")}</p>
        {:else}
          <ul class="m-0" style="padding-left: 0; list-style: none;">
            {#each remotes as r (r.name)}
              <li class="v-row" style="gap: 10px; padding: 2px 0;">
                <b style="min-width: 64px;">{r.name}</b>
                <code class="v-muted" style="font-size: 11px; flex: 1;">{r.url}</code>
                <button class="v-btn" style="padding: 0 8px;" onclick={() => void removeRemote(r.name)}>✕</button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
{/if}
