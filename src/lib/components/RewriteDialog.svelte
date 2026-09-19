<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type AgentInfo } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";

  interface Props {
    /** The selected passage to rewrite. */
    text: string;
    onClose: () => void;
    /** Called with (replacement, provider) on Apply. Parent does the apply. */
    onApply: (text: string, provider: string) => void;
  }

  let { text, onClose, onApply }: Props = $props();

  let providers = $state<AgentInfo[]>([]);
  let provider = $state("");
  let busy = $state(false);
  let applying = $state(false);
  let error = $state("");
  let result = $state<string | null>(null);

  interface DiffLine {
    kind: "same" | "del" | "add";
    text: string;
  }

  /** Line diff: common prefix/suffix kept, middle shown as del + add. */
  function lineDiff(a: string, b: string): DiffLine[] {
    const al = a.split("\n");
    const bl = b.split("\n");
    let start = 0;
    while (start < al.length && start < bl.length && al[start] === bl[start]) start++;
    let endA = al.length;
    let endB = bl.length;
    while (endA > start && endB > start && al[endA - 1] === bl[endB - 1]) {
      endA--;
      endB--;
    }
    const out: DiffLine[] = [];
    for (let i = 0; i < start; i++) out.push({ kind: "same", text: al[i] });
    for (let i = start; i < endA; i++) out.push({ kind: "del", text: al[i] });
    for (let i = start; i < endB; i++) out.push({ kind: "add", text: bl[i] });
    for (let i = endA; i < al.length; i++) out.push({ kind: "same", text: al[i] });
    return out;
  }

  let diff = $derived(result === null ? [] : lineDiff(text, result));

  async function detect(): Promise<void> {
    if (!isTauri()) return;
    try {
      const all = await api.agentsDetect();
      // Rewrite providers: anything connected/detected except the gh CLI
      // (that one is for git, not prose).
      providers = all.filter((a) => a.state !== "missing" && a.id !== "gh");
      if (!provider && providers.length > 0) provider = providers[0].id;
    } catch {
      providers = [];
    }
  }

  onMount(() => {
    void detect();
  });

  async function doRewrite(): Promise<void> {
    if (busy || !provider) return;
    busy = true;
    error = "";
    result = null;
    try {
      result = await api.aiRewrite(provider, text);
    } catch (e) {
      error = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }

  function doApply(): void {
    if (result === null || applying) return;
    applying = true;
    onApply(result, provider);
  }
</script>

<div class="v-dialog-backdrop" onclick={onClose} role="presentation">
  <div
    class="v-dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t("ai.rewrite")}
    onclick={(e) => e.stopPropagation()}
    style="width: min(680px, calc(100vw - 48px)); max-height: 85vh; display: flex; flex-direction: column;"
  >
    <div class="v-row flex-shrink-0" style="justify-content: space-between;">
      <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("ai.rewrite")}</h2>
      <button class="v-btn" style="padding: 2px 10px;" onclick={onClose}>✕</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-4">
      <div class="v-row mb-3" style="gap: 8px;">
        <label class="v-row" style="gap: 8px; font-size: 13px;">
          {t("ai.provider")}
          <select
            value={provider}
            onchange={(e) => (provider = (e.currentTarget as HTMLSelectElement).value)}
            style="min-width: 160px;"
          >
            {#each providers as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </label>
        <button
          class="v-btn"
          disabled={busy || !provider}
          onclick={() => void doRewrite()}
        >
          {busy ? t("ai.busy") : t("ai.rewrite")}
        </button>
      </div>

      {#if providers.length === 0 && !busy}
        <p class="v-muted m-0" style="font-size: 13px;">{t("ai.noProviders")}</p>
      {/if}

      {#if error}
        <p class="m-0 mb-3" style="font-size: 13px; color: var(--warn);">{error}</p>
      {/if}

      {#if result !== null}
        <div
          role="region"
          aria-label={t("ai.preview")}
          class="v-card overflow-y-auto"
          style="max-height: 45vh; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; line-height: 1.5;"
        >
          {#each diff as line, index (index)}
            <div
              style={
                line.kind === "del"
                  ? "background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); white-space: pre-wrap; word-break: break-word;"
                  : line.kind === "add"
                    ? "background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--text); white-space: pre-wrap; word-break: break-word;"
                    : "color: var(--text-mute); white-space: pre-wrap; word-break: break-word;"
              }
            >
              <span aria-hidden="true" class="v-muted" style="display: inline-block; width: 1.2em;">
                {line.kind === "del" ? "−" : line.kind === "add" ? "+" : " "}
              </span>
              {line.text}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="v-row flex-shrink-0" style="justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
      <button class="v-btn" onclick={onClose}>{t("ai.discard")}</button>
      <button
        class="v-btn"
        style="background: var(--accent); color: var(--bg-app);"
        disabled={result === null || applying}
        onclick={doApply}
      >
        {t("ai.apply")}
      </button>
    </div>
  </div>
</div>
