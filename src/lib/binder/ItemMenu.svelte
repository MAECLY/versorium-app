<script module lang="ts">
  /**
   * The item menu that is open, app-wide. Opening another closes it first, and
   * that has to happen here: Shift+F10 on another row sends no pointerdown to
   * close the first one.
   */
  let current: { close: () => void } | null = null;
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { restoreFocus } from "$lib/components/restoreFocus";
  import { isContextMenuKey, type MenuAnchor } from "$lib/contextmenu/policy";
  import type { ItemAction } from "$lib/binder/itemActions.svelte";

  /**
   * The per-item actions for a novel or a chapter.
   *
   * A small menu rather than buttons on every row: a binder row is mostly a
   * title, and three icons crowding it would make the list harder to read for
   * the sake of operations used once a month. Opened by the ⋯ button, by
   * right-clicking the row or the corkboard card, and by Shift+F10 or the Menu
   * key on either, which is where people already reach for this. Every route
   * renders this one component.
   */
  let {
    actions,
    label,
    onChoose,
    trigger = true,
    onOpenChange,
  }: {
    actions: ItemAction[];
    label: string;
    onChoose: (id: string) => void;
    /** Cards pass false: no ⋯ on a card ("almost no icons"), only the panel. */
    trigger?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  /** Kept clear of the window's edge, so the last row's menu is never cut off. */
  const EDGE = 8;

  let open = $state(false);
  let left = $state(0);
  let top = $state(0);
  let root: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();

  // Plain variables: they describe one opening, and nothing renders from them.
  let returnTo: Element | null = null;
  let fromTrigger = false;
  const handle = { close };

  /**
   * Opens the menu at a point, or under the ⋯ when there is none.
   *
   * Focus goes to the first item, and returns on close to whatever had it
   * before. The press guard cancels a right-click's press, so that is still
   * the manuscript when the writer was typing, and choosing an item hands
   * them straight back to their caret.
   */
  export async function openAt(anchor?: MenuAnchor): Promise<void> {
    if (current && current !== handle) current.close();
    current = handle;
    if (!panel?.contains(document.activeElement)) returnTo = document.activeElement;
    fromTrigger = !anchor;
    const at = anchor ?? belowTrigger();
    left = at.x;
    top = at.y;
    if (!open) {
      open = true;
      onOpenChange?.(true);
    }
    await tick();
    if (!open || !panel) return;
    // Measured after render, because only then is the panel's size known.
    // Fixed rather than absolute, so the binder's scrolling list cannot clip it.
    const box = panel.getBoundingClientRect();
    left = clamp(at.align === "end" ? at.x - box.width : at.x, EDGE, window.innerWidth - box.width - EDGE);
    top = clamp(at.y, EDGE, window.innerHeight - box.height - EDGE);
    items()[0]?.focus({ preventScroll: true });
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
  }

  function belowTrigger(): MenuAnchor {
    const box = (button ?? root)?.getBoundingClientRect();
    return { x: box?.right ?? 0, y: box?.bottom ?? 0, align: "end" };
  }

  function items(): HTMLButtonElement[] {
    return panel ? [...panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : [];
  }

  /**
   * Every close gives focus back before the panel goes, or it would fall to
   * <body> along with the panel; after an outside pointerdown the browser then
   * moves it on to whatever was clicked. Only while focus is still inside the
   * panel: when it has already gone elsewhere, as when Shift+F10 on another
   * row closes this menu, it stays where it went.
   *
   * Marked closed before focus moves, because moving it fires the panel's
   * focusout, which must find the menu already closed. The panel itself stays
   * in the DOM until Svelte's next flush.
   */
  function close(): void {
    if (!open) return;
    open = false;
    if (current === handle) current = null;
    if (panel?.contains(document.activeElement)) giveFocusBack();
    onOpenChange?.(false);
  }

  /**
   * Focus taken out of the menu by something other than a press, Tab or
   * Escape (the app moving it, or VoiceOver's cursor with keyboard focus
   * following it) closes the menu. Otherwise it would stay open where Escape,
   * which only the panel handles, can no longer reach it. A null
   * relatedTarget names nowhere and is left alone: a window blur closes the
   * menu on its own, and a press on the ⋯ in WebKit, which takes no focus,
   * looks exactly like code dropping focus to <body>, yet its click must
   * still find the menu open to close it.
   */
  function onPanelFocusOut(event: FocusEvent): void {
    const to = event.relatedTarget;
    if (to instanceof Node && !root?.contains(to)) close();
  }

  /**
   * Back to what had focus, or, when that is <body> or gone, to the thing the
   * menu belongs to: the ⋯ it was opened from, or the row's or card's own
   * button, which its zone marks with data-item-key.
   */
  function giveFocusBack(): void {
    const owner = root?.parentElement?.querySelector<HTMLElement>(":scope > [data-item-key]");
    const before = returnTo === document.body ? null : returnTo;
    for (const el of [before, fromTrigger ? button : owner, button]) {
      if (restoreFocus(el)) return;
    }
  }

  function choose(id: string): void {
    close();
    onChoose(id);
  }

  function onPanelKey(event: KeyboardEvent): void {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (at + 1) % list.length;
    else if (event.key === "ArrowUp") next = at <= 0 ? list.length - 1 : at - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === "Tab") {
      // Not prevented: with focus already back on the return target, Tab's
      // default moves on from there, as if the menu had never been opened.
      event.stopPropagation();
      close();
      return;
    } else {
      // Inside an open menu the menu keys do nothing, not even the engine's
      // own menu on top of this one.
      if (isContextMenuKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    list[next]?.focus({ preventScroll: true });
  }

  // Window listeners only while open: a binder of forty chapters would
  // otherwise run forty of each on every pointerdown and scroll.
  $effect(() => {
    if (!open) return;
    /** A menu that stays open after the pointer has gone elsewhere is a trap. */
    const onPointerDown = (event: PointerEvent): void => {
      if (root && !root.contains(event.target as Node)) close();
    };
    /** The document keeps the restored element focused for when the window comes back. */
    const onBlur = (event: FocusEvent): void => {
      if (event.target === window) close();
    };
    /** Only scrolls that move the menu's anchor; scrolling the editor or the panel leaves it. */
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target === document || (target instanceof Node && !!root && target.contains(root))) close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  onDestroy(() => {
    if (current === handle) current = null;
  });
</script>

<div bind:this={root}>
  {#if trigger}
    <button
      bind:this={button}
      class="v-btn"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      style="padding: 0 6px; font-size: 13px; line-height: 1.4; border: 0; background: transparent;"
      onclick={() => {
        if (open) close();
        else void openAt();
      }}
    >
      ⋯
    </button>
  {/if}

  {#if open}
    <!-- mousedown is cancelled so a press on the padding or the separator does
         not drop focus out of the menu. No contextmenu handler: the policy has
         already cancelled the page menu here, and the zone ignores it. -->
    <div
      bind:this={panel}
      role="menu"
      tabindex="-1"
      aria-label={label}
      style="
        position: fixed; left: {left}px; top: {top}px; z-index: 30; min-width: 176px;
        background: var(--bg-elev); border: 1px solid var(--border);
        border-radius: var(--radius-card); padding: 4px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      "
      onkeydown={onPanelKey}
      onfocusout={onPanelFocusOut}
      onmousedown={(e) => e.preventDefault()}
    >
      {#each actions as action (action.id)}
        {#if action.destructive}
          <div role="separator" style="height: 1px; margin: 4px 2px; background: var(--border);"></div>
        {/if}
        <!-- Chosen on click, which only the primary button fires: a
             right-press dragged onto Delete and released never deletes. -->
        <button
          role="menuitem"
          tabindex="-1"
          class="v-btn"
          style="
            display: block; width: 100%; text-align: left; border: 0;
            background: transparent; padding: 5px 9px; font-size: 12.5px;
            {action.destructive ? 'color: var(--warn);' : ''}
          "
          onclick={() => choose(action.id)}
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
