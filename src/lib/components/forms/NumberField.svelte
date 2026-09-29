<script lang="ts">
  import Field from "$lib/components/forms/Field.svelte";

  /**
   * A bounded integer field.
   *
   * The draft exists because the DOM reports "" for a cleared or unparseable
   * number input, and Number("") is 0 — which is how a backup retention count of
   * zero reached api.backupConfigure, and how an empty port box shipped a
   * non-number to a Tauri command typed `port: number`. Half-typed text never
   * leaves this component.
   *
   * min/max are clamped here rather than left to the attributes, because no
   * number field in this app is inside a <form> and nothing calls
   * checkValidity(), so native constraint validation never fires.
   */
  let {
    label,
    value = $bindable(0),
    min,
    max,
    step = 1,
    hint,
    error,
    describedBy,
    labelHidden = false,
    inline = false,
    disabled = false,
    busy = false,
    /** Width in characters of the widest expected value; no pixel guessing. */
    chars = 4,
    /** Opt in to an in-app stepper; labels are required because it has none. */
    stepper,
    onCommit,
  }: {
    label: string;
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    hint?: string;
    error?: string;
    describedBy?: string;
    labelHidden?: boolean;
    inline?: boolean;
    disabled?: boolean;
    busy?: boolean;
    chars?: number;
    stepper?: { down: string; up: string };
    /** change/blur/step, after clamping. The only edge that should persist. */
    onCommit?: (next: number) => void;
  } = $props();

  const id = $props.id();
  let locked = $derived(disabled || busy);

  let draft = $state(String(value));
  let editing = $state(false);

  // Re-seed from the parent, but not while the writer is mid-keystroke.
  $effect(() => {
    const incoming = String(value);
    if (!editing) draft = incoming;
  });

  function clamp(n: number): number {
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }

  function settle(next: number): void {
    draft = String(next);
    const changed = next !== value;
    value = next;
    // Only when it actually moved. `commit` runs on change AND on blur, and
    // typing a number then clicking away fires both — which saved the same
    // value twice, and in the backup panel that is two writes of settings.json
    // and two rewrites of every destination list.
    if (changed) onCommit?.(next);
  }

  function commit(): void {
    if (!editing) return;
    editing = false;
    const parsed = Number(draft);
    // An empty or nonsense box reverts to the last good value rather than
    // inventing one.
    settle(draft.trim() === "" || Number.isNaN(parsed) ? value : clamp(parsed));
  }

  function nudge(by: number): void {
    const from = Number(draft);
    settle(clamp((Number.isNaN(from) ? value : from) + by));
  }
</script>

<Field {id} {label} {hint} {error} {describedBy} {labelHidden} {inline}>
  {#snippet control({ describedBy: described, invalid })}
    <span class="v-number">
      {#if stepper}
        <button
          type="button"
          class="v-btn v-btn-step"
          aria-label={stepper.down}
          disabled={locked || (min !== undefined && value <= min)}
          onclick={() => nudge(-step)}
        >
          <span aria-hidden="true">&minus;</span>
        </button>
      {/if}

      <input
        {id}
        type="number"
        inputmode="numeric"
        {min}
        {max}
        {step}
        value={draft}
        disabled={locked}
        style:width="{chars + 3}ch"
        aria-busy={busy || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={described}
        oninput={(e) => {
          editing = true;
          draft = e.currentTarget.value;
        }}
        onchange={commit}
        onblur={commit}
      />

      {#if stepper}
        <button
          type="button"
          class="v-btn v-btn-step"
          aria-label={stepper.up}
          disabled={locked || (max !== undefined && value >= max)}
          onclick={() => nudge(step)}
        >
          <span aria-hidden="true">+</span>
        </button>
      {/if}
    </span>
  {/snippet}
</Field>
