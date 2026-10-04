<script module lang="ts">
  /**
   * One item in a menu. `action` items run and close the menu; `checkbox`
   * items toggle a setting and say whether it is on. A checkbox item is
   * strictly controlled, like forms/Checkbox: `checked` is always the prop,
   * and a toggle only asks the owner to change it.
   */
  export interface MenuItem {
    id: string;
    label: string;
    /** Renders in the warning colour and sits after a separator. */
    destructive?: boolean;
    kind?: "action" | "checkbox";
    checked?: boolean;
  }

  /**
   * The menu that is open, app-wide. Opening another closes it first, and
   * that has to happen here: Shift+F10 on another row sends no pointerdown to
   * close the first one.
   */
  let current: { close: () => void; root: () => HTMLElement | undefined } | null = null;

  /**
   * Closes the open menu, or only the one inside `within` when given.
   *
   * For the surfaces that fold away: a row's menu left open in a panel that
   * goes inert can no longer be reached, and its focus has already dropped to
   * <body>, so Escape would never get to it. Scoped, so the Focus options menu
   * that folded the panel stays open while the writer ticks the next item.
   */
  export function closeOpenMenu(within?: Element | null): void {
    if (!current) return;
    if (within !== undefined) {
      const root = current.root();
      if (!within || !root || !within.contains(root)) return;
    }
    current.close();
  }
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { restoreFocus } from "$lib/components/restoreFocus";
  import { isContextMenuKey, type MenuAnchor } from "$lib/contextmenu/policy";

  /**
   * The app's one menu: a WAI-ARIA menu button and the menu it opens.
   *
   * The binder's ⋯ on every row, the corkboard card's right-click and the
   * Focus options in the status bar all render this. Opened by its trigger,
   * by right-clicking the row or card (contextMenuZone), and by Shift+F10 or
   * the Menu key, which is where people already reach for a menu.
   */
  let {
    items,
    label,
    onChoose,
    onToggle,
    trigger = true,
    triggerClass = "v-btn v-menu-dots",
    triggerText = "⋯",
    triggerTitle,
    menuId,
    placement = "below-end",
    heading,
    note,
    onOpenChange,
  }: {
    items: MenuItem[];
    /** The trigger's and the menu's accessible name. */
    label: string;
    onChoose?: (id: string) => void;
    /** A checkbox item asking to become `next`. The owner decides. */
    onToggle?: (id: string, next: boolean) => void;
    /** Cards pass false: no ⋯ on a card ("almost no icons"), only the menu. */
    trigger?: boolean;
    triggerClass?: string;
    triggerText?: string;
    triggerTitle?: string;
    menuId?: string;
    /** Where the menu opens from its trigger. The status bar has no room below. */
    placement?: "below-end" | "above-end";
    /** Names the group of checkbox items; a menu with one renders no separators. */
    heading?: string;
    /** A line under the items, outside the menu, read as its description. */
    note?: string;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  /** Kept clear of the window's edge, so the last row's menu is never cut off. */
  const EDGE = 8;
  /** Between a menu that opens upward and its trigger. */
  const GAP = 4;

  const uid = $props.id();
  const panelId = $derived(menuId ?? `${uid}-menu`);
  const headingId = `${uid}-heading`;
  const noteId = `${uid}-note`;

  let open = $state(false);
  let left = $state(0);
  let top = $state(0);
  let root: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  let pop: HTMLDivElement | undefined = $state();

  // Plain variables: they describe one opening, and nothing renders from them.
  let returnTo: Element | null = null;
  let fromTrigger = false;
  let placedAt: MenuAnchor | null = null;
  const handle = { close, root: () => root };

  /**
   * Opens the menu at a point, or at its trigger when there is none, with
   * focus on the first item (or the last, for ↑ on the trigger).
   *
   * Focus returns on close to whatever had it before. The press guard cancels
   * a right-click's press, so that is still the manuscript when the writer was
   * typing, and choosing an item hands them straight back to their caret.
   */
  export async function openAt(anchor?: MenuAnchor, land: "first" | "last" = "first"): Promise<void> {
    if (current && current !== handle) current.close();
    current = handle;
    if (!pop?.contains(document.activeElement)) returnTo = document.activeElement;
    fromTrigger = !anchor;
    const at = anchor ?? atTrigger();
    placedAt = at;
    left = at.x;
    top = at.y;
    if (!open) {
      open = true;
      onOpenChange?.(true);
    }
    await tick();
    if (!open || !pop) return;
    place();
    const list = itemEls();
    (land === "last" ? list[list.length - 1] : list[0])?.focus({ preventScroll: true });
  }

  /**
   * Puts the menu against its anchor, inside the window. Measured after
   * render, because only then is the menu's size known, and again whenever
   * that size changes while open (below). Fixed rather than absolute, so the
   * binder's scrolling list cannot clip it.
   */
  function place(): void {
    const at = placedAt;
    if (!open || !pop || !at) return;
    const box = pop.getBoundingClientRect();
    const x = at.align === "end" ? at.x - box.width : at.x;
    const y = at.side === "above" ? at.y - box.height - GAP : at.y;
    left = clamp(x, EDGE, window.innerWidth - box.width - EDGE);
    top = clamp(y, EDGE, window.innerHeight - box.height - EDGE);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
  }

  function atTrigger(): MenuAnchor {
    const box = (button ?? root)?.getBoundingClientRect();
    if (placement === "above-end") return { x: box?.right ?? 0, y: box?.top ?? 0, align: "end", side: "above" };
    return { x: box?.right ?? 0, y: box?.bottom ?? 0, align: "end" };
  }

  function itemEls(): HTMLButtonElement[] {
    return pop ? [...pop.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]')] : [];
  }

  function itemOf(el: Element | null): MenuItem | undefined {
    const id = el instanceof HTMLElement ? el.dataset.menuItem : undefined;
    return id === undefined ? undefined : items.find((item) => item.id === id);
  }

  /**
   * Every close gives focus back before the menu goes, or it would fall to
   * <body> along with it; after an outside pointerdown the browser then moves
   * it on to whatever was clicked. Only while focus is still inside the menu:
   * when it has already gone elsewhere, as when Shift+F10 on another row
   * closes this menu, it stays where it went.
   *
   * Marked closed before focus moves, because moving it fires the menu's
   * focusout, which must find the menu already closed. The menu itself stays
   * in the DOM until Svelte's next flush.
   */
  function close(): void {
    if (!open) return;
    open = false;
    if (current === handle) current = null;
    if (pop?.contains(document.activeElement)) giveFocusBack();
    onOpenChange?.(false);
  }

  /**
   * Focus taken out of the menu by something other than a press, Tab or
   * Escape (the app moving it, or VoiceOver's cursor with keyboard focus
   * following it) closes the menu. Otherwise it would stay open where Escape,
   * which only the menu handles, can no longer reach it. A null relatedTarget
   * names nowhere and is left alone: a window blur closes the menu on its own,
   * and a press on the trigger in WebKit, which takes no focus, looks exactly
   * like code dropping focus to <body>, yet its click must still find the menu
   * open to close it.
   */
  function onPanelFocusOut(event: FocusEvent): void {
    const to = event.relatedTarget;
    if (to instanceof Node && !root?.contains(to)) close();
  }

  /**
   * Back to what had focus, or, when that is <body> or gone, to the thing the
   * menu belongs to: the trigger it was opened from, or the row's or card's
   * own button, which its zone marks with data-item-key.
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
    onChoose?.(id);
  }

  /** Asks the owner to flip the item. Space and a click keep the menu open, so both items can be set in one visit. */
  function toggle(item: MenuItem, keepOpen: boolean): void {
    if (!keepOpen) close();
    onToggle?.(item.id, !item.checked);
  }

  /** ↓ and ↑ on the trigger open the menu on its first and last item (APG menu button). */
  function onTriggerKey(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    void openAt(undefined, event.key === "ArrowUp" ? "last" : "first");
  }

  /** A character typed in an open menu: the next item whose label starts with it. */
  function typeAhead(char: string, list: HTMLButtonElement[], at: number): number | null {
    const wanted = char.toLocaleLowerCase();
    for (let step = 1; step <= list.length; step += 1) {
      const index = (at + step) % list.length;
      if (itemOf(list[index])?.label.toLocaleLowerCase().startsWith(wanted)) return index;
    }
    return null;
  }

  function onPanelKey(event: KeyboardEvent): void {
    const list = itemEls();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null;
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
    } else if (event.key === " " || event.key === "Enter") {
      // An action item is a button and activates itself with a click. A
      // checkbox item is handled here, before the button's own activation,
      // which would turn Space into a click that cannot tell the two apart.
      const item = itemOf(document.activeElement);
      if (item?.kind !== "checkbox") return;
      event.preventDefault();
      event.stopPropagation();
      toggle(item, event.key === " ");
      return;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      next = typeAhead(event.key, list, at);
      event.preventDefault();
      event.stopPropagation();
      if (next === null) return;
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

  /**
   * mousedown is cancelled so a press on the padding, the heading, the note or
   * a separator does not drop focus out of the menu. An attachment rather than
   * onmousedown: the wrapper is presentational, and a handler on it would read
   * as an interactive element without a role.
   */
  const keepFocus: Attachment<HTMLElement> = (node) => {
    const cancel = (event: MouseEvent): void => event.preventDefault();
    node.addEventListener("mousedown", cancel);
    return () => node.removeEventListener("mousedown", cancel);
  };

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

  // A menu whose size changes while open keeps its edge on its anchor: Focus
  // options' note comes and goes as its items are ticked, and a menu placed
  // upward from the status bar would otherwise grow down off the window.
  $effect(() => {
    if (!open || !pop || typeof ResizeObserver === "undefined") return;
    const resized = new ResizeObserver(() => place());
    resized.observe(pop);
    return () => resized.disconnect();
  });

  // Gone while open (its owner unmounted it: the status bar's group goes when
  // the project closes): the owner still hears it closed, or Focus options
  // would leave chrome.menuOpen true and the edges awake for good.
  onDestroy(() => {
    if (open) {
      open = false;
      onOpenChange?.(false);
    }
    if (current === handle) current = null;
  });
</script>

{#snippet row(item: MenuItem)}
  {#if item.kind === "checkbox"}
    <button
      role="menuitemcheckbox"
      aria-checked={item.checked ? "true" : "false"}
      tabindex="-1"
      class="v-menu-item"
      data-menu-item={item.id}
      onclick={() => toggle(item, true)}
    >
      <span class="v-menu-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>{item.label}
    </button>
  {:else}
    <!-- Chosen on click, which only the primary button fires: a right-press
         dragged onto Delete and released never deletes. -->
    <button
      role="menuitem"
      tabindex="-1"
      class="v-menu-item"
      class:v-menu-danger={item.destructive}
      data-menu-item={item.id}
      onclick={() => choose(item.id)}
    >
      {item.label}
    </button>
  {/if}
{/snippet}

<div bind:this={root}>
  {#if trigger}
    <button
      bind:this={button}
      class={triggerClass}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-label={label}
      title={triggerTitle}
      onclick={() => {
        if (open) close();
        else void openAt();
      }}
      onkeydown={onTriggerKey}
    >
      {triggerText}
    </button>
  {/if}

  {#if open}
    <!-- No contextmenu handler: the policy has already cancelled the page menu
         here, and the zone ignores a right-click from its own menu. -->
    <div bind:this={pop} class="v-menu-pop" style="left: {left}px; top: {top}px;" {@attach keepFocus}>
      {#if heading}
        <!-- Outside role=menu, which may own only items, groups and
             separators; the group takes its name from here. -->
        <div id={headingId} class="v-menu-heading">{heading}</div>
      {/if}
      <div
        role="menu"
        id={panelId}
        tabindex="-1"
        aria-label={label}
        aria-describedby={note ? noteId : undefined}
        onkeydown={onPanelKey}
        onfocusout={onPanelFocusOut}
      >
        {#if heading}
          <div role="group" aria-labelledby={headingId}>
            {#each items as item (item.id)}
              {@render row(item)}
            {/each}
          </div>
        {:else}
          {#each items as item (item.id)}
            {#if item.destructive}
              <div role="separator" class="v-menu-sep"></div>
            {/if}
            {@render row(item)}
          {/each}
        {/if}
      </div>
      {#if note}
        <p id={noteId} class="v-menu-note">{note}</p>
      {/if}
    </div>
  {/if}
</div>
