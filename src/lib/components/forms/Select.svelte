<script lang="ts" generics="T extends string">
  import Field from "$lib/components/forms/Field.svelte";

  type SelectOption<V extends string> = {
    value: V;
    label: string;
    disabled?: boolean;
  };
  type SelectGroup<V extends string> = {
    label: string;
    options: readonly SelectOption<V>[];
  };

  /**
   * A native <select>, themed.
   *
   * It stays native on purpose. The popup escapes the `overflow-y: auto` that
   * RewriteDialog nests it in and the 80vh cap on Modal; it is the only keyboard
   * type-ahead the app gets for free; optgroups (the Local AI slot picker) would
   * have to be rebuilt by hand; and six Playwright assertions drive it with
   * selectOption. appearance:none plus a drawn chevron takes the OS arrow off the
   * closed control and leaves everything else alone.
   *
   * The value is opaque. It is never parsed, never round-tripped through JSON or
   * a data attribute, and never checked against `options` — RewriteDialog's value
   * is a composite key containing a literal NUL, and it is assigned in the same
   * tick its options arrive, so a component that "validated" it on update would
   * wipe the writer's configured agent.
   */
  let {
    label,
    value = $bindable(),
    options = [],
    groups = [],
    hint,
    error,
    describedBy,
    labelHidden = false,
    inline = false,
    grow = false,
    disabled = false,
    busy = false,
    loading = false,
    placeholder,
    minWidth,
    onChange,
  }: {
    label: string;
    /** Opaque to this component: never parsed, never validated, never reset. */
    value: T;
    options?: readonly SelectOption<T>[];
    groups?: readonly SelectGroup<T>[];
    hint?: string;
    error?: string;
    describedBy?: string;
    labelHidden?: boolean;
    inline?: boolean;
    grow?: boolean;
    disabled?: boolean;
    busy?: boolean;
    /** Choices have not arrived yet: locks the control and shows placeholder. */
    loading?: boolean;
    placeholder?: string;
    /** A call-site layout decision, so it arrives as a CSS length, not a token. */
    minWidth?: string;
    onChange?: (next: T) => void;
  } = $props();

  const id = $props.id();
  let locked = $derived(disabled || busy || loading);
  let empty = $derived(options.length === 0 && groups.length === 0);
</script>

<Field {id} {label} {hint} {error} {describedBy} {labelHidden} {inline} {grow}>
  {#snippet control({ describedBy: described, invalid })}
    <span class="v-select" style:min-width={minWidth}>
      <select
        {id}
        bind:value
        disabled={locked}
        aria-busy={busy || loading || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={described}
        onchange={(e) => onChange?.(e.currentTarget.value as T)}
      >
        {#if placeholder !== undefined && empty}
          <option value="" disabled>{placeholder}</option>
        {/if}

        {#each options as option (option.value)}
          <option value={option.value} disabled={option.disabled}>{option.label}</option>
        {/each}

        {#each groups as group (group.label)}
          <optgroup label={group.label}>
            {#each group.options as option (option.value)}
              <option value={option.value} disabled={option.disabled}>{option.label}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </span>
  {/snippet}
</Field>
