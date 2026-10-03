<script lang="ts">
  import Field from "$lib/components/forms/Field.svelte";

  /**
   * Every single-line text control in the app.
   *
   * `value` is bindable, which is what most call sites want, but it also works
   * one-way: writing to a bindable prop the parent did not bind stays local, so
   * a call site that owns the truth elsewhere (AuthorSection swapping profiles,
   * GitPanel clearing the box after a commit) can keep passing `value={...}`
   * plus `onInput`, and a later reassignment from the parent still wins.
   *
   * `onSubmit` is for call sites with no <form>. Inside a <form>, leave it unset:
   * the form already delivers Enter and handling it here as well submits twice.
   */
  let {
    label,
    value = $bindable(""),
    type = "text",
    hint,
    error,
    placeholder,
    describedBy,
    labelHidden = false,
    inline = false,
    required = false,
    disabled = false,
    busy = false,
    grow = false,
    trim = false,
    autoFocus = false,
    selectOnFocus = false,
    autocomplete,
    name,
    spellcheck,
    onInput,
    onCommit,
    onSubmit,
    element = $bindable(undefined),
  }: {
    label: string;
    value?: string;
    type?: "text" | "search" | "password" | "email" | "url";
    hint?: string;
    error?: string;
    placeholder?: string;
    describedBy?: string;
    /** Keeps the accessible name, drops the visible text. */
    labelHidden?: boolean;
    inline?: boolean;
    required?: boolean;
    disabled?: boolean;
    /** Work is in flight for this field: locks it and says so to AT. */
    busy?: boolean;
    grow?: boolean;
    /** Trim on commit, so the guard and the value that ships agree. */
    trim?: boolean;
    autoFocus?: boolean;
    /** For fields that open pre-filled and are meant to be typed over. */
    selectOnFocus?: boolean;
    autocomplete?: HTMLInputElement["autocomplete"];
    name?: string;
    spellcheck?: boolean;
    /** Every keystroke. For call sites that derive from the live value. */
    onInput?: (next: string) => void;
    /** change/blur, after trimming. Fires once per settle, not twice. */
    onCommit?: (next: string) => void;
    /** Enter. Only for call sites with NO surrounding <form>. */
    onSubmit?: () => void;
    element?: HTMLInputElement | undefined;
  } = $props();

  const id = $props.id();
  let locked = $derived(disabled || busy);

  /**
   * Focus has to survive a re-render, not only a mount. Onboarding swaps step
   * bodies inside one <dialog> that calls showModal() exactly once, so the
   * autofocus attribute would fire for the first step and never again. Keeping
   * it opt-in also matters for GitPanel, where the tabs destroy and recreate
   * their fields on every switch.
   */
  $effect(() => {
    if (!autoFocus || locked || !element) return;
    element.focus();
    if (selectOnFocus) element.select();
  });

  function commit(next: string): void {
    const settled = trim ? next.trim() : next;
    if (settled !== value) value = settled;
    onCommit?.(settled);
  }
</script>

<Field {id} {label} {hint} {error} {describedBy} {labelHidden} {inline} {grow}>
  {#snippet control({ describedBy: described, invalid })}
    <input
      bind:this={element}
      {id}
      {type}
      {name}
      {value}
      {placeholder}
      {required}
      {autocomplete}
      {spellcheck}
      disabled={locked}
      aria-busy={busy || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={described}
      onfocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
      oninput={(e) => {
        value = e.currentTarget.value;
        onInput?.(value);
      }}
      onchange={(e) => commit(e.currentTarget.value)}
      onkeydown={(e) => {
        // isComposing: during IME or dead-key composition the Enter that commits
        // a candidate also fires keydown, which is how RenameDialog fires a
        // rename on a half-composed CJK or accented title today.
        if (!onSubmit || e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        commit(e.currentTarget.value);
        onSubmit();
      }}
    />
  {/snippet}
</Field>
