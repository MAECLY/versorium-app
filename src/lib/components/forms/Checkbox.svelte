<script lang="ts">
  /**
   * A checkbox whose accessible name is its label and nothing else.
   *
   * That is the whole point of it. Today a status readout lives inside the
   * wrapping <label>, so the censorship control announces as "Censorship — On"
   * and renames itself to "Censorship — Off" when clicked, while the sentence
   * explaining the consequence sits in an orphan <p> that assistive technology
   * never reaches. `suffix` and `hint` put both back where they belong.
   *
   * It does NOT draw the box. `accent-color`, the padding reset and the states
   * are in styles.css and apply to every checkbox in the app, component or not.
   *
   * Strictly controlled, deliberately. An earlier draft made `checked`
   * bindable; a review found that when a parent passes `checked={x}` without
   * binding, the child's write stays local and the box appears ticked even
   * though the backend refused the change. So the DOM is never the source of
   * truth here: it is pushed back to the prop on every change, and the caller
   * decides what the answer is. Two-way call sites write
   * `checked={x} onChange={(v) => (x = v)}`, which is one line and no
   * ambiguity.
   */
  let {
    label,
    checked = false,
    hint,
    error,
    /** A live state readout. Rendered OUTSIDE the label, so never in the name. */
    suffix,
    describedBy,
    disabled = false,
    busy = false,
    /** Neither on nor off: the status read has not resolved, or it failed. */
    indeterminate = false,
    onChange,
  }: {
    label: string;
    checked?: boolean;
    hint?: string;
    error?: string;
    suffix?: string;
    describedBy?: string;
    disabled?: boolean;
    busy?: boolean;
    indeterminate?: boolean;
    onChange?: (next: boolean) => void;
  } = $props();

  const id = $props.id();
  let element = $state<HTMLInputElement | undefined>();
  let locked = $derived(disabled || busy);

  let hintId = $derived(hint ? `${id}-hint` : undefined);
  let errorId = $derived(error ? `${id}-error` : undefined);
  let described = $derived(
    [describedBy, hintId, errorId].filter((v): v is string => Boolean(v)).join(" ") || undefined,
  );

  // `indeterminate` is a property, not an attribute: markup cannot set it. The
  // same effect re-asserts `checked`, which is what keeps the browser's own
  // toggle from outliving a refusal.
  $effect(() => {
    if (!element) return;
    element.indeterminate = indeterminate;
    element.checked = checked;
  });
</script>

<div class="v-check">
  <div class="v-check-row">
    <input
      bind:this={element}
      {id}
      type="checkbox"
      {checked}
      disabled={locked}
      aria-busy={busy || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={described}
      onchange={(e) => {
        const next = e.currentTarget.checked;
        // Put it back immediately. If the caller agrees it will come round as
        // a new `checked`; if it does not, the box tells the truth.
        e.currentTarget.checked = checked;
        onChange?.(next);
      }}
    />
    <label class="v-check-label" for={id}>{label}</label>
    {#if suffix}<span class="v-check-suffix v-muted">{suffix}</span>{/if}
  </div>

  {#if hint}<p class="v-field-hint" id={hintId}>{hint}</p>{/if}
  {#if error}<p class="v-field-error" id={errorId} role="alert">{error}</p>{/if}
</div>
