<script lang="ts">
  import { onMount, type Snippet } from "svelte";

  let { label, onClose, children, wide = false }: {
    label: string;
    onClose: () => void;
    children: Snippet;
    wide?: boolean;
  } = $props();

  let dialog: HTMLDialogElement;

  onMount(() => dialog.showModal());

  function dismissBackdrop(event: PointerEvent): void {
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
