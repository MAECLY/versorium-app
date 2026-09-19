<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type AgentInfo } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { lineDiff } from "$lib/ai/diff";
  import { detectAgents } from "$lib/ai/agents";
  import Modal from "$lib/components/Modal.svelte";

  interface Props {
    /** The selected passage to rewrite. */
    text: string;
    onClose: () => void;
    /** Parent applies (checkpoint → write → ops); a thrown error keeps the dialog open. */
    onApply: (text: string, provider: string) => Promise<void>;
  }

  let { text, onClose, onApply }: Props = $props();

  let providers = $state<AgentInfo[]>([]);
  let detecting = $state(isTauri());
  let provider = $state("");
  let busy = $state(false);
  let applying = $state(false);
  let error = $state("");
  let result = $state<string | null>(null);

  let diff = $derived(result === null ? [] : lineDiff(text, result));
  let selected = $derived(providers.find((p) => p.id === provider));
  // Where the passage goes (spec §2.3): Ollama stays on this machine, the rest ride the CLI login.
  let kind = $derived(selected?.id === "ollama" ? "local" : "cli");

  function label(p: AgentInfo): string {
    const model = p.id === "ollama" ? p.models?.[0] : undefined;
    return model ? `${p.name} · ${model}` : p.name;
  }

  async function detect(): Promise<void> {
    if (!isTauri()) return;
    detecting = true;
    try {
      const all = await detectAgents();
      // gh is for git, not prose.
      providers = all.filter((a) => a.state !== "missing" && a.id !== "gh");
      if (!providers.some((p) => p.id === provider)) provider = providers[0]?.id ?? "";
    } catch {
      providers = [];
    } finally {
      detecting = false;
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

  async function doApply(): Promise<void> {
    if (result === null || applying) return;
    applying = true;
    error = "";
    try {
      await onApply(result, provider);
    } catch (e) {
      error = store.codeMessagePublic(e);
    } finally {
      applying = false;
    }
  }
</script>

<Modal label={t("ai.rewrite")} {onClose} wide>
  <div class="v-row flex-shrink-0" style="justify-content: space-between;">
    <h2 class="m-0" style="font-size: 16px; font-weight: 600;">{t("ai.rewrite")}</h2>
    <button class="v-btn" style="padding: 2px 10px;" onclick={onClose} aria-label={t("dialog.cancel")}>✕</button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto py-4">
    <div class="v-row mb-2" style="gap: 8px; flex-wrap: wrap;">
      <label class="v-row" style="gap: 8px; font-size: 13px;">
        {t("ai.provider")}
        <select bind:value={provider} style="min-width: 180px;" disabled={busy || applying}>
          {#each providers as p (p.id)}
            <option value={p.id}>{label(p)}</option>
          {/each}
        </select>
      </label>
      <button class="v-btn" disabled={busy || applying || !provider} onclick={() => void doRewrite()}>
        {busy ? t("ai.busy") : t("ai.rewrite")}
      </button>
    </div>

    {#if selected}
      <p class="v-row m-0 mb-3" style="font-size: 12px; gap: 8px;">
        <span
          style="padding: 1px 8px; border-radius: 999px; font-weight: 600; letter-spacing: 0.03em; font-size: 11px; color: var(--accent-contrast); background: {kind === 'local' ? 'var(--privacy-local, var(--accent))' : 'var(--privacy-cli, var(--accent))'};"
        >
          {kind === "local" ? t("ai.kindLocal") : t("ai.kindCli")}
        </span>
        <span class="v-muted">{t("ai.callGoesTo", { provider: selected.name })}</span>
      </p>
    {/if}

    {#if detecting}
      <p class="v-muted m-0" style="font-size: 13px;" aria-live="polite">{t("agents.checking")}</p>
    {:else if providers.length === 0 && !busy}
      <p class="v-muted m-0" style="font-size: 13px;">{t("ai.noProviders")}</p>
    {/if}

    {#if error}
      <p role="alert" class="m-0 mb-3" style="font-size: 13px; color: var(--warn);">{error}</p>
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
                ? "background: var(--diff-del); color: var(--warn); white-space: pre-wrap; word-break: break-word;"
                : line.kind === "add"
                  ? "background: var(--diff-add); color: var(--text); white-space: pre-wrap; word-break: break-word;"
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

  <div class="v-row flex-shrink-0" style="justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
    <span class="v-muted" style="font-size: 12px;">{t("ai.checkpointNote")}</span>
    <span class="v-row" style="gap: 8px;">
      <button class="v-btn" onclick={onClose} disabled={applying}>{t("ai.discard")}</button>
      <button class="v-btn v-btn-primary" disabled={result === null || applying || busy} onclick={() => void doApply()}>
        {t("ai.apply")}
      </button>
    </span>
  </div>
</Modal>
