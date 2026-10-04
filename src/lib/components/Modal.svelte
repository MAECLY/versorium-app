<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { isContextPress } from "$lib/contextmenu/policy";
  import { restoreFocus } from "$lib/components/restoreFocus";

  let { label, onClose, children, wide = false }: {
    label: string;
    onClose: () => void;
    children: Snippet;
    wide?: boolean;
  } = $props();

  let dialog: HTMLDialogElement;

  onMount(() => {
    const active = document.activeElement;
    const prev = active instanceof HTMLElement && active !== document.body && !dialog.contains(active)
      ? active
      : null;
    dialog.showModal();
    // Every button route (Cancel, submit, Done, a confirmed delete) unmounts
    // the <dialog> without close(), and a removed dialog leaves focus on
    // <body> in Chrome and WebKit, so a keyboard writer would have to start
    // over from the top of the window. Svelte runs this after the dialog is
    // already detached. Escape and the backdrop go through close(), which
    // restores focus itself, and then there is nothing to do here.
    return () => {
      const now = document.activeElement;
      if ((now === null || now === document.body) && prev?.isConnected) restoreFocus(prev);
    };
  });

  /**
   * Only a plain primary press dismisses. A right-click, or a Ctrl+click on a
   * Mac, used to close the dialog before any menu appeared, which skipped the
   * tour for good, threw away an unapplied rewrite and dismissed an update.
   */
  function dismissBackdrop(event: PointerEvent): void {
    if (event.button !== 0 || isContextPress(event)) return;
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="v-dialog"
  class:wide
  aria-label={label}
  onclose={onClose}
  onpointerdown={dismissBackdrop}
>
  {@render children()}
</dialog>

<style>
  dialog { margin: auto; max-height: 80vh; color: var(--text); }
  dialog[open] { display: flex; flex-direction: column; }
  dialog.wide { width: min(560px, calc(100vw - 48px)); }
  dialog::backdrop { background: color-mix(in srgb, var(--text) 30%, transparent); }
</style>
