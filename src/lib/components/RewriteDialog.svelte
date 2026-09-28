<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, type SlotKind } from "$lib/tauri";
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

  /** One thing the passage can be sent to, as a settings slot assignment. */
  interface Choice {
    kind: SlotKind;
    id: string;
    label: string;
    /** Set on the model configured under Settings → Local AI → Rewrite. */
    configured: boolean;
  }

  /** The three harnesses that rewrite prose. `gh` is for git, and Rust refuses it. */
  const PROSE_HARNESSES = ["claude", "codex", "opencode"];

  let choices = $state<Choice[]>([]);
  let detecting = $state(isTauri());
  /** `<kind>\u0000<id>` — a select value has to be a string, and an id alone is
   * ambiguous once the same name can be both an Ollama tag and a catalog id. */
  let picked = $state("");
  let busy = $state(false);
  let applying = $state(false);
  let error = $state("");
  let result = $state<string | null>(null);

  let diff = $derived(result === null ? [] : lineDiff(text, result));
  let selected = $derived(choices.find((c) => key(c) === picked));
  // Where the passage goes (spec §2.3): weights on this machine stay here, a
  // harness rides its own login.
  let kind = $derived(selected?.kind === "cli" ? "cli" : "local");

  function key(c: { kind: SlotKind; id: string }): string {
    return `${c.kind}\u0000${c.id}`;
  }

  /**
   * Build the list from the same three sources Settings offers, so a choice
   * here is a slot assignment Rust can dispatch on. Sending a bare provider
   * name used to leave Rust picking whichever model the daemon listed first.
   */
  async function detect(): Promise<void> {
    if (!isTauri()) return;
    detecting = true;
    try {
      const [view, agents] = await Promise.all([api.modelsView(), detectAgents()]);
      const configured = view.slots.rewrite;
      const isConfigured = (k: SlotKind, id: string) =>
        configured.kind === k && configured.id === id;

      const builtin: Choice[] = view.models
        .filter((m) => m.task === "writing" && m.state === "ready")
        .map((m) => ({
          kind: "builtin" as const,
          id: m.id,
          label: m.label,
          configured: isConfigured("builtin", m.id),
        }));
      const ollama: Choice[] = (view.ollama.running ? view.ollama.models : []).map((m) => ({
        kind: "ollama" as const,
        id: m.name,
        label: `Ollama · ${m.name}`,
        configured: isConfigured("ollama", m.name),
      }));
      const cli: Choice[] = agents
        .filter((a) => a.state !== "missing" && PROSE_HARNESSES.includes(a.id))
        .map((a) => ({
          kind: "cli" as const,
          id: a.id,
          label: a.name,
          configured: isConfigured("cli", a.id),
        }));

      // Built-in weights come last only because nothing loads them yet: an
      // option that always fails must not be what the dialog opens on. Move
      // them first once there is an engine — local is the preferred path.
      choices = [...ollama, ...cli, ...builtin];
      // The configured slot wins; otherwise keep a still-valid pick, then fall
      // back to the first option so the button is never armed with nothing.
      const preferred = choices.find((c) => c.configured);
      if (preferred) picked = key(preferred);
      else if (!choices.some((c) => key(c) === picked)) picked = choices[0] ? key(choices[0]) : "";
    } catch {
      choices = [];
    } finally {
      detecting = false;
    }
  }

  onMount(() => {
    void detect();
  });

  async function doRewrite(): Promise<void> {
    if (busy || !selected) return;
    busy = true;
    error = "";
    result = null;
    try {
      result = await api.aiRewrite(selected.kind, selected.id, text);
    } catch (e) {
      error = store.codeMessagePublic(e);
    } finally {
      busy = false;
    }
  }

  async function doApply(): Promise<void> {
    if (result === null || applying || !selected) return;
    applying = true;
    error = "";
    try {
      // Attribute to the model, not the family: `ai:claude` for a harness,
      // `ai:qwen3.8:latest` for a daemon tag. Ops authors are opaque strings.
      await onApply(result, selected.id);
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
        <select bind:value={picked} style="min-width: 180px;" disabled={busy || applying}>
          {#each choices as c (key(c))}
            <option value={key(c)}>{c.configured ? `${c.label} ${t("ai.configuredSuffix")}` : c.label}</option>
          {/each}
        </select>
      </label>
      <button class="v-btn" disabled={busy || applying || !selected} onclick={() => void doRewrite()}>
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
        <span class="v-muted">{t("ai.callGoesTo", { provider: selected.label })}</span>
      </p>
    {/if}

    {#if detecting}
      <p class="v-muted m-0" style="font-size: 13px;" aria-live="polite">{t("agents.checking")}</p>
    {:else if choices.length === 0 && !busy}
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
