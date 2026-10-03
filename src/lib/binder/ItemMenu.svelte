<script lang="ts">
  import { t } from "$lib/i18n";

  /**
   * The per-item actions for a novel or a chapter.
   *
   * A small menu rather than buttons on every row: a binder row is mostly a
   * title, and three icons crowding it would make the list harder to read for
   * the sake of operations used once a month. Opened by the ⋯ button or by
   * right-clicking the row, which is where people already reach for this.
   */
  interface Action {
    id: string;
    label: string;
    /** Renders in the warning colour and sits after a divider. */
    destructive?: boolean;
  }

  let {
    actions,
    label,
    onChoose,
  }: {
    actions: Action[];
    label: string;
    onChoose: (id: string) => void;
  } = $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();

  function choose(id: string): void {
    open = false;
    onChoose(id);
  }

  /** A menu that stays open after the pointer has gone elsewhere is a trap. */
  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    if (root && !root.contains(event.target as Node)) open = false;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKey} />

<div bind:this={root} style="position: relative;">
  <button
    class="v-btn"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    style="padding: 0 6px; font-size: 13px; line-height: 1.4; border: 0; background: transparent;"
    onclick={(e) => {
      e.stopPropagation();
      open = !open;
    }}
  >
    ⋯
  </button>

  {#if open}
    <div
      role="menu"
      aria-label={label}
      style="
        position: absolute; right: 0; top: 100%; z-index: 30; min-width: 176px;
        background: var(--bg-elev); border: 1px solid var(--border);
        border-radius: var(--radius-card); padding: 4px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      "
    >
      {#each actions as action (action.id)}
        {#if action.destructive}
          <div style="height: 1px; margin: 4px 2px; background: var(--border);"></div>
        {/if}
        <button
          role="menuitem"
          class="v-btn"
          style="
            display: block; width: 100%; text-align: left; border: 0;
            background: transparent; padding: 5px 9px; font-size: 12.5px;
            {action.destructive ? 'color: var(--warn);' : ''}
          "
          onclick={(e) => {
            e.stopPropagation();
            choose(action.id);
          }}
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
